/**
 * One-time notices about the environment a request is about to be made in.
 *
 * Both conditions here are silent failures rather than errors: the request goes
 * out and something the caller expected to happen simply did not. They are
 * reported once per process, on stderr, so a loop over many rows says it once
 * and a piped stdout stays parseable.
 */

const reported = new Set<string>()

function once(key: string, message: string): void {
  if (reported.has(key)) return
  reported.add(key)
  process.stderr.write(`warning: ${message}\n`)
}

/** Test seam: notices are once-per-process, and each test needs a clean slate. */
export function resetEnvironmentNotices(): void {
  reported.clear()
}

const PROXY_VARIABLES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

/**
 * The first release of each Node line whose built-in proxy support reads the
 * environment variables. Lines absent here never got it: 23 reached end of life
 * before the backport, so it is not "between two supported versions" — treating
 * it as capable would silence the warning on the one line that most needs it.
 */
const PROXY_SUPPORT: Record<number, number> = { 22: 21, 24: 5 }

/** The first Node line to ship the support, so every later line has it. */
const FIRST_SUPPORTED_MAJOR = 24

/**
 * Whether this runtime can act on `HTTP(S)_PROXY` at all.
 *
 * Node reads them only from v22.21 and v24.5, and only when opted into. Before
 * that the variables are inert no matter what is set.
 */
function runtimeCanProxy(version: string): boolean {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false

  const firstSupportedMinor = PROXY_SUPPORT[major]
  if (firstSupportedMinor !== undefined) return minor >= firstSupportedMinor
  return major > FIRST_SUPPORTED_MAJOR
}

/**
 * Reports a proxy the request will not actually go through.
 *
 * Node's `fetch` ignores `HTTP(S)_PROXY` unless `NODE_USE_ENV_PROXY` opts in,
 * and older releases ignore them outright — so on a network that only reaches
 * the API through a proxy, every command fails to connect while the variable
 * that would have fixed it is already set. The CLI cannot enable the support
 * from inside the process (Node reads the flag at startup), so it says what to
 * do instead of proxying itself, which would mean bundling an HTTP stack for a
 * setting the platform now owns.
 */
export function warnIfProxyIgnored(
  env: NodeJS.ProcessEnv = process.env,
  version: string = process.version
): void {
  const variable = PROXY_VARIABLES.find((name) => env[name])
  if (!variable) return
  if (env.NODE_USE_ENV_PROXY && runtimeCanProxy(version)) return

  once(
    'proxy',
    runtimeCanProxy(version)
      ? `${variable} is set but Node only uses it when NODE_USE_ENV_PROXY=1. Re-run with NODE_USE_ENV_PROXY=1 to route through the proxy.`
      : `${variable} is set but Node ${version} cannot use it. Upgrade to Node 22.21 or 24.5 and set NODE_USE_ENV_PROXY=1 to route through the proxy.`
  )
}

/** Hosts where cleartext is the normal case rather than a mistake. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

function isLoopback(hostname: string): boolean {
  return LOOPBACK.has(hostname) || hostname.endsWith('.localhost')
}

/**
 * Reports an API key about to cross the network in cleartext.
 *
 * A warning rather than a refusal: `http://` is the documented way to reach a
 * local dev server, and an internal deployment terminating TLS at a gateway is
 * a real deployment, not a mistake to block. Loopback is silent because that is
 * the documented case; anything else means the key is on the wire in the clear,
 * which is worth one line.
 */
export function warnIfCredentialOverCleartext(endpoint: string, hasCredential: boolean): void {
  if (!hasCredential) return

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return
  }
  if (url.protocol !== 'http:' || isLoopback(url.hostname)) return

  once(
    'cleartext',
    `sending your Sim credentials to ${url.host} over http. Anything on the path can read them — use https unless this network is trusted.`
  )
}
