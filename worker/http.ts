import type { ApiError } from "../shared/types";
import { getSessionAccount, type Env } from "./auth";

export type JsonBody = Record<string, unknown>;

export class RequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json<T>(data: T, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

export function error(message: string, status = 400): Response {
  return json<ApiError>({ error: message }, status);
}

export async function readJson(request: Request): Promise<JsonBody> {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return {};
  }

  try {
    return (await request.json()) as JsonBody;
  } catch {
    return {};
  }
}

export async function requireAccount(env: Env, request: Request) {
  const account = await getSessionAccount(env, request);

  if (!account) {
    return { account: null, response: error("로그인이 필요합니다.", 401) };
  }

  return { account, response: null };
}
