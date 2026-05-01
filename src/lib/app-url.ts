type RequestLike = {
  url: string;
};

function normalizeBaseUrl(value: string) {
  const normalized = value.endsWith("/") ? value : `${value}/`;
  return new URL(normalized);
}

export function getAppBaseUrl(request: RequestLike) {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return normalizeBaseUrl(configuredBaseUrl);
  }

  return new URL("/", request.url);
}

