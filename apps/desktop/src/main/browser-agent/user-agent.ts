/**
 * The user agent the browser resource presents to sites.
 *
 * Electron's default string carries two tokens no browser sends —
 * `Sim/<version>` and `Electron/<version>`. Chromium's own token sits right
 * beside them, but that does not save it: the detection libraries sites gate on
 * test for Electron BEFORE Chrome (bowser matches `/electron/i` several
 * descriptors ahead of its Chrome one, ua-parser-js reports `Electron` as the
 * browser name), so the browser reads as "Electron", which is on nobody's
 * supported list. Ashby warns "Ashby does not support this browser"; stricter
 * sites refuse to render at all.
 *
 * Reporting stock Chrome is accurate rather than a disguise — the engine is the
 * Chromium build the token already names, and Electron's user-agent client
 * hints (`Sec-CH-UA`, `navigator.userAgentData`) only ever carried a Chromium
 * brand, so dropping the token makes the header and the hints agree instead of
 * contradicting each other.
 */
import { app } from 'electron'

/** Platform token, then the Chromium major version, in the order a Chromium user agent lists them. */
const CHROMIUM_USER_AGENT = /^Mozilla\/5\.0 \(([^)]*)\).* Chrome\/(\d+)\./

/**
 * Rebuilds the default user agent as the string Chrome itself sends. Chrome's
 * user-agent reduction fixes the desktop form at
 * `Mozilla/5.0 (<platform>) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36`,
 * so keeping the platform token and the Chromium major version — and zeroing
 * the rest — reproduces it exactly, with no room left for an application or
 * Electron token. A string that is not a Chromium user agent is returned
 * unchanged rather than replaced with a guess.
 */
export function stockChromeUserAgent(defaultUserAgent: string): string {
  const match = defaultUserAgent.match(CHROMIUM_USER_AGENT)
  if (!match) return defaultUserAgent
  const [, platform, chromeMajor] = match
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
}

/**
 * Derived from the string Electron would otherwise have sent, so the reported
 * Chromium version tracks whatever Chromium the app actually ships.
 */
export function browserUserAgent(): string {
  return stockChromeUserAgent(app.userAgentFallback)
}
