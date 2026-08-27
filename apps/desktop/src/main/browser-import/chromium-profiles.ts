import { constants } from 'node:fs'
import { access, lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isRecordLike } from '@sim/utils/object'
import {
  BROWSER_SOURCES,
  type BrowserSource,
  formatProfileId,
  userDataDirFor,
} from '@/main/browser-import/browser-sources'
import type { BrowserProfile } from '@/main/browser-import/types'

/**
 * Discovers profiles across the Chromium-family browsers on this device.
 *
 * Strictly read-only: a browser's own directory is never written to, and a
 * profile is only offered when its database is actually readable, so the UI
 * cannot advertise an import that is guaranteed to fail.
 */

/** Chromium moved the cookie database under `Network/` in M96. */
const COOKIE_DB_RELATIVE_PATHS = [join('Network', 'Cookies'), 'Cookies']
/** Saved passwords stay at the profile root and may span local and account stores. */
const LOGIN_DB_RELATIVE_PATHS = ['Login Data', 'Login Data For Account']
/** Site icons, used to give saved passwords a recognisable face. */
const FAVICON_DB_RELATIVE_PATHS = ['Favicons']
/** Page titles, read only to learn what the imported sites are called. */
const HISTORY_DB_RELATIVE_PATHS = ['History']
/** Internal profiles that never hold a user's browsing session. */
const IGNORED_PROFILE_DIRS = new Set(['System Profile', 'Guest Profile'])
const PROFILE_DIR_PATTERN = /^(Default|Profile \d{1,4})$/
const MAX_PROFILES_PER_BROWSER = 32

/**
 * Names a browser uses for its own machinery rather than for a person. Arc
 * keeps `__ARC_SYSTEM_PROFILE` in an ordinary `Profile N` directory, so the
 * directory name alone does not reveal it — offering it as something to import
 * would be meaningless at best.
 */
function isInternalProfileName(name: string): boolean {
  return name.startsWith('__')
}

/**
 * Whether a profile's name is just Chromium's placeholder rather than
 * something the user chose. `Your Chrome`, `Your Chromium`, and `Person 1` all
 * mean "unnamed" — showing them as a profile's identity is noise, and shows
 * the same string twice when two browsers are both unnamed.
 */
function isGenericProfileName(name: string, directory: string, browserLabel: string): boolean {
  return (
    name === directory ||
    name === browserLabel ||
    /^Person \d+$/.test(name) ||
    /^Your [\w ]+$/.test(name)
  )
}

async function isSafeProfileDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Resolves one fixed database name without following profile/database links.
 *
 * Browser profile discovery is read-only, but following a crafted symlink
 * here could make selecting one profile import another profile's passwords.
 * Canonical equality also rejects a symlink in an intermediate directory such
 * as `Network/`. Multi-link files are refused for the same cross-profile
 * ambiguity; Chromium creates these databases as ordinary single-link files.
 */
async function readableDatabasePath(
  profileDir: string,
  relativePath: string
): Promise<string | null> {
  const candidate = join(profileDir, relativePath)
  try {
    const [profileInfo, candidateInfo, canonicalProfile, canonicalCandidate] = await Promise.all([
      lstat(profileDir),
      lstat(candidate),
      realpath(profileDir),
      realpath(candidate),
    ])
    if (!profileInfo.isDirectory() || profileInfo.isSymbolicLink()) return null
    if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink() || candidateInfo.nlink !== 1) {
      return null
    }
    if (canonicalCandidate !== join(canonicalProfile, relativePath)) return null
    await access(candidate, constants.R_OK)
    return candidate
  } catch {
    return null
  }
}

async function resolveFirstReadable(
  profileDir: string,
  relativePaths: readonly string[]
): Promise<string | null> {
  for (const relative of relativePaths) {
    const candidate = await readableDatabasePath(profileDir, relative)
    if (candidate) return candidate
  }
  return null
}

async function resolveReadableFiles(
  profileDir: string,
  relativePaths: readonly string[]
): Promise<string[]> {
  const paths: string[] = []
  for (const relative of relativePaths) {
    const candidate = await readableDatabasePath(profileDir, relative)
    if (candidate) paths.push(candidate)
  }
  return paths
}

/**
 * A browser's display names, keyed by profile directory.
 *
 * `Local State` is JSON this process does not own, so every key is checked
 * against {@link PROFILE_DIR_PATTERN} before it is used in a path — that check
 * is what keeps a crafted key from escaping the user-data directory.
 */
async function readProfileDisplayNames(userDataDir: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  try {
    const raw = await readFile(join(userDataDir, 'Local State'), 'utf8')
    const infoCache = (JSON.parse(raw) as { profile?: { info_cache?: unknown } }).profile
      ?.info_cache
    if (isRecordLike(infoCache)) {
      for (const [dir, info] of Object.entries(infoCache as Record<string, unknown>)) {
        if (!PROFILE_DIR_PATTERN.test(dir)) continue
        const name = (info as { name?: unknown })?.name
        names.set(dir, typeof name === 'string' && name.trim().length > 0 ? name.trim() : dir)
      }
    }
  } catch {
    // No or unreadable Local State: fall back to directory scanning below.
  }
  return names
}

async function listProfileDirNames(userDataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(userDataDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && PROFILE_DIR_PATTERN.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** `Default` first, then `Profile 2`, `Profile 10`, … in numeric order. */
function compareProfileDirs(left: string, right: string): number {
  if (left === right) return 0
  if (left === 'Default') return -1
  if (right === 'Default') return 1
  const index = (dir: string): number => Number(dir.slice('Profile '.length))
  return index(left) - index(right)
}

/**
 * Profiles belonging to one browser. Resolves to an empty list when that
 * browser is not installed — absence is a normal state, not an error.
 */
export async function listBrowserProfiles(
  source: BrowserSource,
  home: string = homedir()
): Promise<BrowserProfile[]> {
  const userDataDir = userDataDirFor(source, home)
  const displayNames = await readProfileDisplayNames(userDataDir)
  const dirNames = new Set([...displayNames.keys(), ...(await listProfileDirNames(userDataDir))])

  const profiles: BrowserProfile[] = []
  for (const dir of [...dirNames].sort(compareProfileDirs).slice(0, MAX_PROFILES_PER_BROWSER)) {
    if (IGNORED_PROFILE_DIRS.has(dir) || !PROFILE_DIR_PATTERN.test(dir)) continue
    const name = displayNames.get(dir) ?? dir
    if (isInternalProfileName(name)) continue
    const profileDir = join(userDataDir, dir)
    if (!(await isSafeProfileDirectory(profileDir))) continue
    const cookiesPath = await resolveFirstReadable(profileDir, COOKIE_DB_RELATIVE_PATHS)
    const loginDataPaths = await resolveReadableFiles(profileDir, LOGIN_DB_RELATIVE_PATHS)
    const faviconsPath = await resolveFirstReadable(profileDir, FAVICON_DB_RELATIVE_PATHS)
    const historyPath = await resolveFirstReadable(profileDir, HISTORY_DB_RELATIVE_PATHS)
    if (cookiesPath === null && loginDataPaths.length === 0) continue
    profiles.push({
      id: formatProfileId(source.id, dir),
      directory: dir,
      // Empty means "the user never named this one", which lets the caller
      // fall back to the browser's name instead of printing a placeholder.
      label: isGenericProfileName(name, dir, source.label) ? '' : name,
      source,
      cookiesPath,
      loginDataPaths,
      faviconsPath,
      historyPath,
    })
  }
  return profiles
}

/**
 * Every importable profile on this device, across every supported browser.
 *
 * One browser failing to enumerate must not hide the others — a broken Brave
 * install should not cost the user their Chrome and Arc profiles.
 */
export async function listAllBrowserProfiles(
  sources: readonly BrowserSource[] = BROWSER_SOURCES,
  home: string = homedir()
): Promise<BrowserProfile[]> {
  const perBrowser = await Promise.all(
    sources.map((source) => listBrowserProfiles(source, home).catch((): BrowserProfile[] => []))
  )
  return perBrowser.flat()
}
