import { S3Client, PutObjectCommand, DeleteObjectsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import postgres, { type Sql } from "postgres";

type FilterOp = "eq" | "neq" | "in" | "is" | "gt" | "gte" | "lt" | "lte";

type Filter = {
  column: string;
  op: FilterOp;
  value: unknown;
};

type Order = {
  column: string;
  ascending: boolean;
};

type SupabaseError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  [key: string]: unknown;
};

type QueryResult<T = unknown> = {
  data: T;
  error: SupabaseError | null;
  count?: number | null;
};

type SelectOptions = {
  count?: "exact";
  head?: boolean;
};

type UpsertOptions = {
  onConflict?: string;
};

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SIMPLE_SELECT_RE = /^\*|[a-zA-Z0-9_,\s]+$/;

function toError(error: unknown): SupabaseError {
  if (error && typeof error === "object") {
    const withMessage = error as { message?: string; code?: string; detail?: string; hint?: string };
    return {
      message: withMessage.message ?? "Unknown error",
      code: withMessage.code,
      details: withMessage.detail,
      hint: withMessage.hint,
    };
  }
  return { message: "Unknown error" };
}

function assertIdentifier(name: string) {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
}

function quoteIdentifier(name: string) {
  assertIdentifier(name);
  return `"${name}"`;
}

function parseColumnList(raw: string) {
  const normalized = raw.trim();
  if (normalized === "*") {
    return "*";
  }
  if (!SIMPLE_SELECT_RE.test(normalized)) {
    throw new Error(`Unsupported select expression: ${raw}`);
  }
  const columns = normalized
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  columns.forEach(assertIdentifier);
  return columns.map(quoteIdentifier).join(", ");
}

function buildWhere(filters: Filter[]) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const filter of filters) {
    const column = quoteIdentifier(filter.column);
    switch (filter.op) {
      case "eq":
        params.push(filter.value);
        clauses.push(`${column} = $${params.length}`);
        break;
      case "neq":
        params.push(filter.value);
        clauses.push(`${column} <> $${params.length}`);
        break;
      case "gt":
        params.push(filter.value);
        clauses.push(`${column} > $${params.length}`);
        break;
      case "gte":
        params.push(filter.value);
        clauses.push(`${column} >= $${params.length}`);
        break;
      case "lt":
        params.push(filter.value);
        clauses.push(`${column} < $${params.length}`);
        break;
      case "lte":
        params.push(filter.value);
        clauses.push(`${column} <= $${params.length}`);
        break;
      case "is":
        if (filter.value === null) {
          clauses.push(`${column} IS NULL`);
        } else {
          clauses.push(`${column} IS NOT NULL`);
        }
        break;
      case "in": {
        const values = Array.isArray(filter.value) ? filter.value : [];
        if (values.length === 0) {
          clauses.push("1 = 0");
          break;
        }
        const placeholders = values.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        clauses.push(`${column} IN (${placeholders.join(", ")})`);
        break;
      }
      default:
        throw new Error(`Unsupported filter operation: ${filter.op as string}`);
    }
  }

  if (clauses.length === 0) {
    return { whereSql: "", params };
  }

  return {
    whereSql: ` WHERE ${clauses.join(" AND ")}`,
    params,
  };
}

function normalizeRows<T>(rows: T | T[] | null | undefined): T[] {
  if (!rows) return [];
  return Array.isArray(rows) ? rows : [rows];
}

async function toBody(value: unknown): Promise<Uint8Array | Buffer | string> {
  if (value instanceof Uint8Array || Buffer.isBuffer(value) || typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "arrayBuffer" in value) {
    const withBuffer = value as { arrayBuffer: () => Promise<ArrayBuffer> };
    return Buffer.from(await withBuffer.arrayBuffer());
  }
  throw new Error("Unsupported upload body");
}

class StorageBucketClient {
  constructor(private readonly bucketName: string, private readonly s3: S3Client) {}

  async upload(
    path: string,
    body: unknown,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<QueryResult<{ path: string }>> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: path,
          Body: await toBody(body),
          ContentType: options?.contentType,
        }),
      );
      return { data: { path }, error: null };
    } catch (error) {
      return { data: { path }, error: toError(error) };
    }
  }

  async remove(paths: string[]): Promise<QueryResult<{ path: string }[]>> {
    if (paths.length === 0) {
      return { data: [], error: null };
    }

    try {
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: paths.map((path) => ({ Key: path })),
            Quiet: true,
          },
        }),
      );
      return {
        data: paths.map((path) => ({ path })),
        error: null,
      };
    } catch (error) {
      return { data: [], error: toError(error) };
    }
  }

  async createSignedUrl(path: string, expiresIn: number): Promise<QueryResult<{ signedUrl: string }>> {
    try {
      const signedUrl = await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.bucketName, Key: path }),
        { expiresIn },
      );
      return { data: { signedUrl }, error: null };
    } catch (error) {
      return { data: { signedUrl: "" }, error: toError(error) };
    }
  }
}

class StorageClient {
  constructor(private readonly s3: S3Client) {}

  from(bucketName: string) {
    return new StorageBucketClient(bucketName, this.s3);
  }
}

class QueryBuilder<T = any> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private selectColumns = "*";
  private selectOptions: SelectOptions = {};
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limitCount: number | null = null;
  private insertRows: Record<string, unknown>[] = [];
  private updateValues: Record<string, unknown> = {};
  private upsertOptions: UpsertOptions = {};
  private returningColumns: string | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private resultPromise: Promise<QueryResult<T[] | T | null>> | null = null;

  constructor(
    private readonly sql: Sql,
    private readonly table: string,
  ) {
    assertIdentifier(table);
  }

  select(columns = "*", options: SelectOptions = {}) {
    if (this.action === "insert" || this.action === "update" || this.action === "upsert" || this.action === "delete") {
      this.returningColumns = columns;
      return this;
    }
    this.action = "select";
    this.selectColumns = columns;
    this.selectOptions = options;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert";
    this.insertRows = normalizeRows(values);
    return this;
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], options: UpsertOptions = {}) {
    this.action = "upsert";
    this.insertRows = normalizeRows(values);
    this.upsertOptions = options;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.action = "update";
    this.updateValues = values;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ column, op: "neq", value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ column, op: "in", value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ column, op: "is", value });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push({ column, op: "is", value: "__not_null__" });
      return this;
    }
    if (operator === "eq") {
      this.filters.push({ column, op: "neq", value });
      return this;
    }
    throw new Error(`Unsupported not() operation: ${operator}`);
  }

  gt(column: string, value: unknown) {
    this.filters.push({ column, op: "gt", value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ column, op: "gte", value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ column, op: "lt", value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ column, op: "lte", value });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this.execute() as Promise<QueryResult<any>>;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this.execute() as Promise<QueryResult<any>>;
  }

  then<TResult1 = QueryResult<T[] | T | null>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T[] | T | null>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute() {
    if (!this.resultPromise) {
      this.resultPromise = this.run();
    }
    return this.resultPromise;
  }

  private async run(): Promise<QueryResult<T[] | T | null>> {
    try {
      const result = await this.runInternal();
      return result;
    } catch (error) {
      return { data: null, error: toError(error), count: null };
    }
  }

  private async runInternal(): Promise<QueryResult<T[] | T | null>> {
    const { whereSql, params } = buildWhere(this.filters);

    if (this.action === "select") {
      if (this.selectOptions.head && this.selectOptions.count === "exact") {
        const countRows = await this.sql.unsafe(
          `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(this.table)}${whereSql}`,
          params as any,
        );
        return {
          data: null,
          error: null,
          count: countRows[0]?.count ?? 0,
        };
      }

      const orderSql = this.orders.length
        ? ` ORDER BY ${this.orders
            .map((order) => `${quoteIdentifier(order.column)} ${order.ascending ? "ASC" : "DESC"}`)
            .join(", ")}`
        : "";
      const limitSql = this.limitCount !== null ? ` LIMIT ${this.limitCount}` : "";
      const selectSql = parseColumnList(this.selectColumns);
      const rows = await this.sql.unsafe(
        `SELECT ${selectSql} FROM ${quoteIdentifier(this.table)}${whereSql}${orderSql}${limitSql}`,
        params as any,
      );
      return this.finalizeSelect(rows as unknown as T[]);
    }

    if (this.action === "insert" || this.action === "upsert") {
      if (this.insertRows.length === 0) {
        return { data: [] as T[], error: null };
      }

      const columns = Object.keys(this.insertRows[0]);
      columns.forEach(assertIdentifier);
      const columnSql = columns.map(quoteIdentifier).join(", ");
      const valueRows = this.insertRows.map((row) => columns.map((column) => row[column]));
      const insertParams: unknown[] = [];
      const valuesSql = valueRows
        .map((row) => {
          const placeholders = row.map((value) => {
            insertParams.push(value);
            return `$${insertParams.length}`;
          });
          return `(${placeholders.join(", ")})`;
        })
        .join(", ");

      let query = `INSERT INTO ${quoteIdentifier(this.table)} (${columnSql}) VALUES ${valuesSql}`;

      if (this.action === "upsert") {
        const conflictTargets = (this.upsertOptions.onConflict ?? "id")
          .split(",")
          .map((target) => target.trim())
          .filter(Boolean);
        conflictTargets.forEach(assertIdentifier);
        const conflictSql = conflictTargets.map(quoteIdentifier).join(", ");
        const updateColumns = columns.filter((column) => !conflictTargets.includes(column));
        if (updateColumns.length > 0) {
          query += ` ON CONFLICT (${conflictSql}) DO UPDATE SET ${updateColumns
            .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
            .join(", ")}`;
        } else {
          query += ` ON CONFLICT (${conflictSql}) DO NOTHING`;
        }
      }

      if (this.returningColumns) {
        query += ` RETURNING ${parseColumnList(this.returningColumns)}`;
      }

      const rows = await this.sql.unsafe(query, insertParams as any);
      return this.finalizeWrite(rows as unknown as T[]);
    }

    if (this.action === "update") {
      const entries = Object.entries(this.updateValues);
      if (entries.length === 0) {
        return { data: [] as T[], error: null };
      }
      const setParams: unknown[] = [];
      const setSql = entries
        .map(([column, value]) => {
          assertIdentifier(column);
          setParams.push(value);
          return `${quoteIdentifier(column)} = $${setParams.length}`;
        })
        .join(", ");

      const shiftedWhereSql = whereSql.replace(/\$(\d+)/g, (_, rawIndex) => {
        return `$${Number(rawIndex) + setParams.length}`;
      });
      const queryParams = [...setParams, ...params];
      let query = `UPDATE ${quoteIdentifier(this.table)} SET ${setSql}${shiftedWhereSql}`;
      if (this.returningColumns) {
        query += ` RETURNING ${parseColumnList(this.returningColumns)}`;
      }
      const rows = await this.sql.unsafe(query, queryParams as any);
      return this.finalizeWrite(rows as unknown as T[]);
    }

    if (this.action === "delete") {
      let query = `DELETE FROM ${quoteIdentifier(this.table)}${whereSql}`;
      if (this.returningColumns) {
        query += ` RETURNING ${parseColumnList(this.returningColumns)}`;
      }
      const rows = await this.sql.unsafe(query, params as any);
      return this.finalizeWrite(rows as unknown as T[]);
    }

    throw new Error(`Unsupported action: ${this.action as string}`);
  }

  private finalizeWrite(rows: T[]): QueryResult<T[] | T | null> {
    if (this.singleMode === "single") {
      if (rows.length !== 1) {
        return { data: null, error: { message: "Expected exactly one row." } };
      }
      return { data: rows[0], error: null };
    }
    if (this.singleMode === "maybeSingle") {
      if (rows.length > 1) {
        return { data: null, error: { message: "Expected zero or one row." } };
      }
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private finalizeSelect(rows: T[]): QueryResult<T[] | T | null> {
    if (this.singleMode === "single") {
      if (rows.length !== 1) {
        return { data: null, error: { message: "Expected exactly one row." } };
      }
      return { data: rows[0], error: null };
    }
    if (this.singleMode === "maybeSingle") {
      if (rows.length > 1) {
        return { data: null, error: { message: "Expected zero or one row." } };
      }
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }
}

class NeonSupabaseClient {
  private storageClient: StorageClient | null = null;

  constructor(private readonly sql: Sql) {}

  get storage() {
    if (!this.storageClient) {
      this.storageClient = new StorageClient(getR2Client());
    }
    return this.storageClient;
  }

  from(table: string) {
    return new QueryBuilder<any>(this.sql, table);
  }
}

let neonSqlClient: Sql | null = null;
let neonStorageClient: S3Client | null = null;
let neonSupabaseClient: NeonSupabaseClient | null = null;

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function getNeonSqlClient() {
  if (!neonSqlClient) {
    neonSqlClient = postgres(getEnv("NEON_DATABASE_URL"), {
      max: 5,
      ssl: "require",
    });
  }
  return neonSqlClient;
}

function getR2Client() {
  if (!neonStorageClient) {
    const accountId = getEnv("R2_ACCOUNT_ID");
    neonStorageClient = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
      },
    });
  }
  return neonStorageClient;
}

export function createSupabaseAdminClient() {
  if (!neonSupabaseClient) {
    neonSupabaseClient = new NeonSupabaseClient(getNeonSqlClient());
  }
  return neonSupabaseClient;
}
