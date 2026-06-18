import type { Env } from "./auth";
import { error } from "./http";

export type StaticApiRoute = {
  pathname: string;
  handle: (env: Env, request: Request, url: URL) => Promise<Response>;
};

export type DynamicApiRoute = {
  pattern: RegExp;
  handle: (env: Env, request: Request, url: URL, match: RegExpMatchArray) => Promise<Response>;
};

export async function dispatchApiRoute(
  env: Env,
  request: Request,
  staticRoutes: StaticApiRoute[],
  dynamicRoutes: DynamicApiRoute[]
): Promise<Response> {
  const url = new URL(request.url);
  const staticRoute = staticRoutes.find((route) => route.pathname === url.pathname);

  if (staticRoute) {
    return staticRoute.handle(env, request, url);
  }

  for (const route of dynamicRoutes) {
    const match = url.pathname.match(route.pattern);

    if (match) {
      return route.handle(env, request, url, match);
    }
  }

  return error("API 경로를 찾을 수 없습니다.", 404);
}
