import { type MatchedRoute, matchV2Route } from '@/lib/api/server/routes/in-process-transport'

/** A contract's path in the generated route table's `{param}` pattern syntax. */
export function v2RoutePattern(contract: { path: string }): string {
  return contract.path.replace(/\[([^\]]+)\]/g, '{$1}')
}

/** Whether a matched request is the method and route a contract declares. */
export function isV2ContractRoute(
  method: string,
  route: Pick<MatchedRoute, 'pattern'>,
  contract: { method: string; path: string }
): boolean {
  return method === contract.method && route.pattern === v2RoutePattern(contract)
}

/** {@link matchV2Route}, reading a malformed percent encoding as no route. */
export function tryMatchV2Route(pathname: string): MatchedRoute | null {
  try {
    return matchV2Route(pathname)
  } catch {
    return null
  }
}
