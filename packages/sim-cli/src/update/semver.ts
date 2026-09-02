/**
 * The version arithmetic the update check needs, and nothing more.
 *
 * The package deliberately carries no `semver` dependency: everything here is
 * bundled into `dist/index.js`, and a full implementation would be several
 * hundred kilobytes to answer one question once a day. What is implemented is
 * the precedence half of the specification — enough to order two published
 * versions — not ranges, not coercion, not satisfaction.
 */

/**
 * `X.Y.Z`, an optional prerelease, an optional build. Leading zeroes are
 * rejected the way the specification rejects them, so a hand-edited `01.2.3`
 * reads as unparseable rather than as `1.2.3`.
 */
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** A prerelease identifier that is all digits compares as a number. */
const NUMERIC_IDENTIFIER = /^(0|[1-9]\d*)$/

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Dot-separated prerelease identifiers, empty for a stable release. */
  prerelease: readonly (string | number)[]
}

/**
 * The three dist-tags `.github/workflows/publish-sim-cli.yml` publishes under.
 *
 * A channel is inferred from the version's own prerelease tag rather than
 * remembered, because the running CLI knows its version and nothing else about
 * how it was installed.
 */
export type ReleaseChannel = 'latest' | 'staging' | 'dev'

/**
 * Parses a published version, or returns null for anything else.
 *
 * Never throws: every caller is on a path that must stay silent, and a local
 * build with a hand-mangled manifest is a normal thing to encounter rather than
 * an error to report.
 */
export function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version)
  if (!match) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null
  }

  const prerelease = match[4]
    ? match[4]
        .split('.')
        .map((identifier) =>
          NUMERIC_IDENTIFIER.test(identifier) ? Number(identifier) : identifier
        )
    : []
  if (
    prerelease.some(
      (identifier) => typeof identifier === 'number' && !Number.isSafeInteger(identifier)
    )
  ) {
    return null
  }

  return { major, minor, patch, prerelease }
}

/**
 * Compares two prerelease identifier lists by the specification's rules.
 *
 * Numeric identifiers compare numerically and sort below alphanumeric ones, and
 * a shorter list sorts below a longer one that shares its prefix. The numeric
 * rule is the one a string comparison gets wrong: `preview.9` is *older* than
 * `preview.44`, which run number ordering depends on.
 */
function comparePrerelease(
  left: readonly (string | number)[],
  right: readonly (string | number)[]
): number {
  // A version carrying a prerelease ranks below the same version without one.
  if (left.length === 0) return right.length === 0 ? 0 : 1
  if (right.length === 0) return -1

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === b) continue
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'number') return -1
    if (typeof b === 'number') return 1
    return a < b ? -1 : 1
  }
  return left.length - right.length
}

/**
 * Semver precedence: negative when left is older, zero when equal, positive
 * when left is newer. Build metadata is ignored, as the specification requires.
 */
export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * The dist-tag a version was published under, or null when its prerelease tag
 * is not one this project publishes.
 *
 * Knowing the channel is what keeps the comparison honest: a `-preview` install
 * is only ever compared against the `staging` tag, so there is no arrangement
 * of inputs that can advise "upgrade" to a stable version that is actually
 * older than what is already installed.
 */
export function channelOf(version: ParsedVersion): ReleaseChannel | null {
  if (version.prerelease.length === 0) return 'latest'
  const [tag] = version.prerelease
  if (tag === 'preview') return 'staging'
  if (tag === 'dev') return 'dev'
  return null
}
