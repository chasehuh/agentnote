import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "memo_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.MEMO_SECRET;
  if (!secret) {
    throw new Error("MEMO_SECRET is not set");
  }
  return secret;
}

function getPassword() {
  const password = process.env.MEMO_PASSWORD;
  if (!password) {
    throw new Error("MEMO_PASSWORD is not set");
  }
  return password;
}

function sign(payload: string) {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createSessionToken() {
  const issuedAt = Date.now().toString();
  const signature = sign(issuedAt);
  return `${issuedAt}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature) return false;

  const issued = Number(issuedAt);
  if (!Number.isFinite(issued)) return false;
  if (Date.now() - issued > MAX_AGE_SECONDS * 1000) return false;

  const expected = sign(issuedAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyPassword(password: string) {
  const expected = Buffer.from(getPassword());
  const actual = Buffer.from(password);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function isAuthenticated() {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}
