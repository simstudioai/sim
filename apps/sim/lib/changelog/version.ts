import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface ReleaseVersion {
  major: number
  minor: number
  patch: number
}

export type VersionBump = 'major' | 'minor' | 'patch'

/** A workspace's first release, whatever bump Sim asks for. */
const FIRST_VERSION: ReleaseVersion = { major: 1, minor: 0, patch: 0 }

/** PostgreSQL integer columns; a component past this cannot be stored. */
const MAX_COMPONENT = 2_147_483_647

export function formatReleaseVersion(version: ReleaseVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

/** Parses `1.4.0` (an optional leading `v` is accepted); throws on anything else. */
export function parseReleaseVersion(value: string): ReleaseVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) {
    throw new OrchestrationError(
      'validation',
      `"${value}" is not a version. Use MAJOR.MINOR.PATCH, like 1.4.0`
    )
  }
  const [major, minor, patch] = match.slice(1).map(Number)
  if ([major, minor, patch].some((component) => component > MAX_COMPONENT)) {
    throw new OrchestrationError('validation', `"${value}" is out of range`)
  }
  return { major, minor, patch }
}

/** The version after the workspace's highest one. */
export function bumpReleaseVersion(
  highest: ReleaseVersion | null,
  bump: VersionBump
): ReleaseVersion {
  if (!highest) return FIRST_VERSION
  const next =
    bump === 'major'
      ? { major: highest.major + 1, minor: 0, patch: 0 }
      : bump === 'minor'
        ? { major: highest.major, minor: highest.minor + 1, patch: 0 }
        : { ...highest, patch: highest.patch + 1 }
  if (Object.values(next).some((component) => component > MAX_COMPONENT)) {
    throw new OrchestrationError(
      'validation',
      `A ${bump} bump from ${formatReleaseVersion(highest)} is out of range`
    )
  }
  return next
}
