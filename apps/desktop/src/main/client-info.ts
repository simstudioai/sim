import { CLIENT_INFO_HEADER, formatClientInfo } from '@sim/utils/client-info'
import type { Session } from 'electron'
import { app } from 'electron'
import { isAppOrigin } from '@/main/navigation'

/**
 * The `X-Sim-Client-Info` value naming this shell: its version, the Electron
 * it runs on, and the platform. Computed once per process — none of it changes
 * while the app is running.
 */
export function desktopClientInfo(): string {
  const electron = process.versions.electron
  return formatClientInfo({
    surface: 'desktop',
    version: app.getVersion(),
    ...(electron ? { runtime: { name: 'electron', version: electron } } : {}),
    os: process.platform,
    arch: process.arch,
  })
}

/**
 * Stamps the shell's identity on every request to the app origin.
 *
 * The page derives the same value from the preload bridge, so this is the
 * backstop for what the page never issues itself — raw `fetch` exceptions,
 * service-worker traffic, sub-resources — and for a bundle older than the
 * bridge field. Only the network layer sees every request. The shell's value
 * overwrites whatever the page sent; the shell is authoritative about being
 * the shell. Requests to other origins are left untouched.
 *
 * This is the only `onBeforeSendHeaders` consumer — Electron allows a single
 * listener per session.
 */
export function attachClientInfo(ses: Session, appOrigin: () => string): void {
  const clientInfo = desktopClientInfo()
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!isAppOrigin(details.url, appOrigin())) {
      callback({})
      return
    }
    const requestHeaders: Record<string, string> = {}
    for (const [name, value] of Object.entries(details.requestHeaders)) {
      if (name.toLowerCase() !== CLIENT_INFO_HEADER) requestHeaders[name] = value
    }
    requestHeaders[CLIENT_INFO_HEADER] = clientInfo
    callback({ requestHeaders })
  })
}
