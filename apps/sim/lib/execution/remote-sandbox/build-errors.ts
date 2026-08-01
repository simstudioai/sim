import { registryFor, type SandboxLanguage } from '@/lib/execution/remote-sandbox/sandbox-spec'

/**
 * Classified reasons a dependency set failed to materialize. The code is what
 * gets stored and reported on; the rendered copy is what the settings UI shows,
 * so a user never meets a raw pip traceback as the primary message.
 */
export type SandboxBuildErrorCode =
  | 'package_not_found'
  | 'version_not_found'
  | 'resolution_conflict'
  | 'build_timeout'
  | 'install_failed'
  | 'provider_error'
  | 'rate_limited'

export interface SandboxBuildError {
  code: SandboxBuildErrorCode
  /** User-facing copy. Never a traceback. */
  message: string
  /** The dependency the failure named, when one could be extracted. */
  dependency?: string
}

/** How much installer output to keep as the disclosure detail. */
export const BUILD_LOG_TAIL_CHARS = 4000

/**
 * Keeps the tail of installer output rather than the head: pip and npm print the
 * actual failure last, after pages of resolution noise.
 */
export function tailBuildLog(output: string): string {
  const trimmed = output.trim()
  if (trimmed.length <= BUILD_LOG_TAIL_CHARS) return trimmed
  return `…\n${trimmed.slice(-BUILD_LOG_TAIL_CHARS)}`
}

interface Matcher {
  code: SandboxBuildErrorCode
  match: RegExp
  render: (language: SandboxLanguage, groups: RegExpMatchArray) => SandboxBuildError
}

/**
 * Ordered installer-output matchers. Order matters: a version miss also mentions
 * the package name, so the more specific pattern has to win.
 */
const MATCHERS: readonly Matcher[] = [
  {
    // `Could not find a version that satisfies the requirement foo==9 (from versions: 1, 2)`
    code: 'version_not_found',
    match:
      /could not find a version that satisfies the requirement ([^\s(]+)[^\n(]*\(from versions:\s*([^)]*)\)/i,
    render: (language, groups) => {
      const available = groups[2]?.trim()
      const known = available && available.toLowerCase() !== 'none'
      if (!known) {
        return {
          code: 'package_not_found',
          dependency: groups[1],
          message: `Package "${groups[1]}" was not found on ${registryFor(language)}.`,
        }
      }
      return {
        code: 'version_not_found',
        dependency: groups[1],
        message: `"${groups[1]}" has no version matching that specifier. Available: ${available}.`,
      }
    },
  },
  {
    // npm: `notarget No matching version found for axios@^99.0.0`
    code: 'version_not_found',
    match: /no matching version found for (\S+)/i,
    render: (_language, groups) => ({
      code: 'version_not_found',
      dependency: groups[1],
      message: `"${groups[1]}" has no version matching that specifier.`,
    }),
  },
  {
    // npm: `404 Not Found - GET https://registry.npmjs.org/does-not-exist`
    code: 'package_not_found',
    match: /404 not found[^\n]*?\/([^/\s'"]+)\s*$/im,
    render: (language, groups) => ({
      code: 'package_not_found',
      dependency: groups[1],
      message: `Package "${groups[1]}" was not found on ${registryFor(language)}.`,
    }),
  },
  {
    code: 'package_not_found',
    match: /no matching distribution found for (\S+)/i,
    render: (language, groups) => ({
      code: 'package_not_found',
      dependency: groups[1],
      message: `Package "${groups[1]}" was not found on ${registryFor(language)}.`,
    }),
  },
  {
    code: 'resolution_conflict',
    match:
      /(resolutionimpossible|conflicting dependencies|eresolve unable to resolve dependency tree|the conflict is caused by)/i,
    render: () => ({
      code: 'resolution_conflict',
      message:
        'These dependencies require incompatible versions of a shared package. Relax or remove a version pin.',
    }),
  },
  {
    code: 'rate_limited',
    match: /\b429\b|too many requests|rate ?limit/i,
    render: (language) => ({
      code: 'rate_limited',
      message: `${registryFor(language)} rate-limited the install. Try again in a few minutes.`,
    }),
  },
]

/**
 * Maps raw installer output onto the taxonomy. Anything unrecognized falls back
 * to `install_failed` with the log retained rather than being dropped — an
 * unclassifiable failure is still a failure the user has to be able to debug.
 */
export function classifyInstallOutput(
  language: SandboxLanguage,
  output: string
): SandboxBuildError {
  for (const matcher of MATCHERS) {
    const groups = output.match(matcher.match)
    if (groups) return matcher.render(language, groups)
  }
  return {
    code: 'install_failed',
    message: 'Installation failed. See the log below.',
  }
}

/** Copy for the failures that have no installer output to classify. */
export function buildTimeoutError(minutes: number): SandboxBuildError {
  return {
    code: 'build_timeout',
    message: `The build took longer than ${minutes} minutes and was stopped.`,
  }
}

export function providerBuildError(detail?: string): SandboxBuildError {
  return {
    code: 'provider_error',
    message: detail
      ? `The sandbox provider rejected the build. Try again shortly. (${detail})`
      : 'The sandbox provider rejected the build. Try again shortly.',
  }
}
