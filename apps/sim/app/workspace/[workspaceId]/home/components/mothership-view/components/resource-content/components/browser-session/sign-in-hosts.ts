interface SignInHost {
  host: string
  /** Match the host's subdomains instead of the host itself. */
  subdomains?: true
  /** Restrict to these path prefixes; omit for the whole host. */
  paths?: readonly string[]
}

/**
 * Sign-in pages that commonly offer a passkey or security key the built-in
 * browser cannot complete. On these the browser panel suggests finishing in
 * the user's own browser. A hint only: the browser menu offers the same action
 * on every https page, so a missing host costs a suggestion, not the feature.
 */
const SIGN_IN_HOSTS: readonly SignInHost[] = [
  { host: 'accounts.google.com' },
  { host: 'signin.aws.amazon.com' },
  { host: 'signin.aws.amazon.com', subdomains: true },
  { host: 'awsapps.com', subdomains: true },
  { host: 'login.microsoftonline.com' },
  { host: 'login.live.com' },
  { host: 'okta.com', subdomains: true },
  { host: 'oktapreview.com', subdomains: true },
  { host: 'github.com', paths: ['/login', '/sessions/two-factor'] },
  { host: 'appleid.apple.com' },
  { host: 'auth0.com', subdomains: true },
]

/**
 * The page as a URL when another browser can continue it: https, and not one of
 * Sim's own pages on `appOrigin`, which the shell refuses to hand off.
 */
export function continuablePage(url: string | undefined, appOrigin: string): URL | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.origin !== appOrigin ? parsed : null
  } catch {
    return null
  }
}

function matchesPath(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * The host to key the hint by when `page` is a known sign-in page, or null.
 * Hosts match on label boundaries, so `accounts.google.com.evil.com` or
 * `evil-okta.com` never qualify.
 */
export function signInHintHost({ hostname, pathname }: URL): string | null {
  const matched = SIGN_IN_HOSTS.some(({ host, subdomains, paths }) => {
    const hostMatches = subdomains ? hostname.endsWith(`.${host}`) : hostname === host
    return hostMatches && (!paths || matchesPath(pathname, paths))
  })
  return matched ? hostname : null
}
