/**
 * Facts about the process environment that more than one feature reads.
 *
 * The update notice and usage telemetry both suppress themselves in CI and
 * both read `SIM_*` switches; one definition keeps the two from disagreeing
 * about what "on" or "in CI" means.
 */

/** Covers CI jobs that allocate a terminal despite being non-interactive. */
const CI_VARIABLES = [
  'CI',
  'GITHUB_ACTIONS',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BUILDKITE',
] as const

/** Anything but unset, empty, `0` or `false` turns a switch on. */
export function isEnabled(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

/** Whether any of the {@link CI_VARIABLES} says this is a CI job. */
export function isCi(env: NodeJS.ProcessEnv = process.env): boolean {
  return CI_VARIABLES.some((variable) => isEnabled(env[variable]))
}

/**
 * The Node proxy flags this process was started with, for a child that must
 * reach the network the same way.
 */
export function proxyExecArgv(): string[] {
  return process.execArgv.filter(
    (argument) => argument === '--use-env-proxy' || argument === '--no-use-env-proxy'
  )
}

/**
 * The process environment for a helper child: proxy and TLS settings intact,
 * the named variables removed so a credential never reaches a process that
 * does not need it, and `extra` added on top.
 */
export function childProcessEnv(
  strip: readonly string[],
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const stripped = new Set(strip.map((name) => name.toLowerCase()))
  for (const key of Object.keys(env)) {
    if (stripped.has(key.toLowerCase())) delete env[key]
  }
  return { ...env, ...extra }
}
