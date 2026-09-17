import type { Session, WebContents } from 'electron'

/**
 * Registry of WebContents that belong to the agent browser (the browser-agent
 * session's tabs). The global security guards consult this to swap the
 * app-origin navigation policy for the agent policy (free http/https
 * browsing) on exactly these contents and nothing else.
 *
 * Registration happens right after a view is constructed; the guards check at
 * navigation time, so the post-construction registration races nothing.
 */
const agentContents = new WeakSet<WebContents>()
const appOrigins = new WeakMap<WebContents, string>()
const navigations = new WeakMap<WebContents, (url: string, method: string) => boolean>()
const permissions = new WeakMap<WebContents, BrowserPermissionHandlers>()

export interface BrowserPermissionHandlers {
  request: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>
  check: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>
}

export function registerAgentWebContents(
  contents: WebContents,
  appOrigin?: string,
  handlers?: BrowserPermissionHandlers
): void {
  agentContents.add(contents)
  if (appOrigin) appOrigins.set(contents, appOrigin)
  if (handlers) permissions.set(contents, handlers)
}

export function isAgentWebContents(contents: WebContents): boolean {
  return agentContents.has(contents)
}

/** Only first-party browser views may use the app's authenticated session. */
export function agentAppOrigin(contents: WebContents): string | undefined {
  return appOrigins.get(contents)
}

/** Browser views keep browser permission policy even when sharing Sim authentication. */
export function agentPermissionHandlers(
  contents: WebContents | null
): BrowserPermissionHandlers | undefined {
  return contents ? permissions.get(contents) : undefined
}

/** Session routing also runs at the request boundary, before redirected requests send cookies. */
export function registerAgentNavigation(
  contents: WebContents,
  route: (url: string, method: string) => boolean
): void {
  navigations.set(contents, route)
}

export function routeAgentNavigation(contents: WebContents, url: string, method = 'GET'): boolean {
  return navigations.get(contents)?.(url, method) ?? false
}
