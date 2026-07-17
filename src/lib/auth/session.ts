import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE_NAME = "team_task_session";
const LINE_STATE_COOKIE_NAME = "team_task_line_state";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export type SessionUser = {
  lineUserId: string;
  displayName: string | null;
  pictureUrl?: string | null;
};

type SessionPayload = {
  lineUserId: string;
  displayName: string | null;
  pictureUrl?: string | null;
  issuedAt: number;
  expiresAt: number;
};

type SignedValue = {
  payload: string;
  signature: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSessionSecret() {
  return process.env.APP_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || "";
}

function getConfiguredSessionMaxAge() {
  const rawValue = process.env.APP_SESSION_MAX_AGE_SECONDS;
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : NaN;
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }

  return DEFAULT_SESSION_MAX_AGE_SECONDS;
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

export function createLineState() {
  return randomBytes(24).toString("base64url");
}

export function createSignedState(state: string) {
  return `${state}.${sign(state)}`;
}

export function verifySignedState(value: string | undefined, expectedState: string) {
  if (!value) return false;

  const [state, signature] = value.split(".");
  if (!state || !signature || state !== expectedState) {
    return false;
  }

  const expectedSignature = sign(state);

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

function encodeSignedValue(payload: SessionPayload): SignedValue {
  const payloadString = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadString);
  const signature = sign(encodedPayload);

  return { payload: encodedPayload, signature };
}

function decodeSignedValue(rawValue: string): SessionPayload | null {
  const [payload, signature] = rawValue.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = sign(payload);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as SessionPayload;
    if (parsed.expiresAt < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function createSessionCookieValue(user: SessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = getSessionMaxAge();
  const signed = encodeSignedValue({
    lineUserId: user.lineUserId,
    displayName: user.displayName,
    pictureUrl: user.pictureUrl ?? null,
    issuedAt: now,
    expiresAt: now + maxAge,
  });

  return `${signed.payload}.${signed.signature}`;
}

export function parseSessionCookieValue(rawValue: string | undefined) {
  if (!rawValue) {
    return null;
  }

  const parsed = decodeSignedValue(rawValue);
  if (!parsed) {
    return null;
  }

  return {
    lineUserId: parsed.lineUserId,
    displayName: parsed.displayName,
    pictureUrl: parsed.pictureUrl ?? null,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
  };
}

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function getLineStateCookieName() {
  return LINE_STATE_COOKIE_NAME;
}

export function getSessionMaxAge() {
  return getConfiguredSessionMaxAge();
}

export function shouldRefreshSession(expiresAt: number) {
  const now = Math.floor(Date.now() / 1000);
  return expiresAt - now < getSessionMaxAge() / 2;
}
