/**
 * The minimum desktop shell version this web deployment supports.
 *
 * The desktop shell is an installed binary that users update on their own
 * schedule, while the web app it loads is deployed continuously — so the
 * preload bridge contract (`@sim/desktop-bridge` + `@sim/browser-protocol`)
 * must stay backward compatible by default. CI enforces that with a contract
 * snapshot audit (`bun run check:desktop-bridge`).
 *
 * When a change genuinely cannot be additive, this floor is the escape
 * hatch: bump it to the desktop release the breaking shell change ships in
 * and regenerate the snapshot (`bun run desktop-bridge-contract:update`).
 * Shells older than the floor get a blocking "update to continue" takeover
 * (see `app/_shell/desktop-update-gate.tsx`) instead of silently broken
 * features.
 *
 * `0.0.0` means no floor — every shell is accepted.
 */
export const MIN_DESKTOP_VERSION = '0.0.0'

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string
}

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?$/

function parseVersion(version: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(version)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  }
}

function comparePrerelease(a: string, b: string): number {
  // A release (no prerelease) outranks any prerelease of the same core.
  if (a === '' || b === '') {
    return a === b ? 0 : a === '' ? 1 : -1
  }
  const aParts = a.split('.')
  const bParts = b.split('.')
  const length = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < length; i++) {
    const aPart = aParts[i]
    const bPart = bParts[i]
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1
    const aNumeric = /^\d+$/.test(aPart)
    const bNumeric = /^\d+$/.test(bPart)
    if (aNumeric && bNumeric) {
      const diff = Number(aPart) - Number(bPart)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (aNumeric !== bNumeric) {
      // Numeric identifiers rank below alphanumeric ones (semver §11).
      return aNumeric ? -1 : 1
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1
    }
  }
  return 0
}

/** Standard semver ordering; null when either version is unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Whether a desktop shell is below the supported floor and must update.
 *
 * Fails closed for shells inside the desktop app: an absent version means the
 * shell predates version reporting (older than any real floor), and an
 * unparseable one can't be vouched for. Both count as outdated whenever a
 * floor is set. With the floor at `0.0.0` nothing is ever gated.
 */
export function isShellOutdated(
  shellVersion: string | undefined,
  minVersion: string = MIN_DESKTOP_VERSION
): boolean {
  if (minVersion === '0.0.0') return false
  if (shellVersion === undefined) return true
  const comparison = compareVersions(shellVersion, minVersion)
  return comparison === null || comparison < 0
}
