export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_COOKIE_NAME?: string;
};

export type SessionAccount = {
  id: number;
  username: string;
  displayName: string;
};

const encoder = new TextEncoder();
const PASSWORD_HASH_ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

export function getCookieName(env: Env): string {
  return env.SESSION_COOKIE_NAME || "stock_contest_session";
}

export function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  const header = request.headers.get("Cookie");

  if (!header) {
    return cookies;
  }

  header.split(";").forEach((cookie) => {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (!rawName) {
      return;
    }
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  });

  return cookies;
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, expectedValue] = storedHash.split("$");

  if (algorithm !== "pbkdf2_sha256" || !iterationsValue || !saltValue || !expectedValue) {
    return false;
  }

  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(base64ToBytes(saltValue)),
      iterations: Number(iterationsValue)
    },
    key,
    256
  );

  return constantTimeEqual(new Uint8Array(derivedBits), base64ToBytes(expectedValue));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(salt),
      iterations: PASSWORD_HASH_ITERATIONS
    },
    key,
    256
  );

  return [
    "pbkdf2_sha256",
    String(PASSWORD_HASH_ITERATIONS),
    bytesToBase64(salt),
    bytesToBase64(new Uint8Array(derivedBits))
  ].join("$");
}

export function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function buildSessionCookie(env: Env, token: string, expiresAt: Date): string {
  const cookieName = getCookieName(env);
  return `${cookieName}=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

export function buildExpiredSessionCookie(env: Env): string {
  const cookieName = getCookieName(env);
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function getSessionAccount(env: Env, request: Request): Promise<SessionAccount | null> {
  const token = parseCookies(request).get(getCookieName(env));

  if (!token) {
    return null;
  }

  const tokenHash = await sha256Base64Url(token);
  const result = await env.DB.prepare(
    `SELECT accounts.id, accounts.username, accounts.display_name AS displayName
     FROM sessions
     INNER JOIN accounts ON accounts.id = sessions.account_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?
     LIMIT 1`
  )
    .bind(tokenHash, new Date().toISOString())
    .first<SessionAccount>();

  return result ?? null;
}

export async function deleteCurrentSession(env: Env, request: Request): Promise<void> {
  const token = parseCookies(request).get(getCookieName(env));

  if (!token) {
    return;
  }

  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256Base64Url(token))
    .run();
}
