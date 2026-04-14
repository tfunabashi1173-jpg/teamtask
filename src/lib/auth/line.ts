const LINE_AUTHORIZE_ENDPOINT = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_ENDPOINT = "https://api.line.me/oauth2/v2.1/token";
const LINE_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";
const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/profile";

type TokenResponse = {
  access_token: string;
  id_token?: string;
};

type VerifyResponse = {
  sub: string;
  name?: string;
};

type ProfileResponse = {
  userId: string;
  displayName: string;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function createLineAuthorizeUrl({
  state,
  nonce,
}: {
  state: string;
  nonce: string;
}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getRequiredEnv("LINE_CHANNEL_ID"),
    redirect_uri: getRequiredEnv("LINE_REDIRECT_URI"),
    state,
    scope: "profile openid",
    nonce,
  });

  return `${LINE_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRequiredEnv("LINE_REDIRECT_URI"),
    client_id: getRequiredEnv("LINE_CHANNEL_ID"),
    client_secret: getRequiredEnv("LINE_CHANNEL_SECRET"),
  });

  const response = await fetch(LINE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to exchange LINE authorization code.");
  }

  return (await response.json()) as TokenResponse;
}

export async function verifyIdToken(idToken: string) {
  const params = new URLSearchParams({
    id_token: idToken,
    client_id: getRequiredEnv("LINE_CHANNEL_ID"),
  });

  const response = await fetch(LINE_VERIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to verify LINE ID token.");
  }

  return (await response.json()) as VerifyResponse;
}

export async function fetchLineProfile(accessToken: string) {
  const response = await fetch(LINE_PROFILE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch LINE profile.");
  }

  return (await response.json()) as ProfileResponse;
}
