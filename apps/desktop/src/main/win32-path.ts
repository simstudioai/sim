import { win32 } from 'node:path'

/**
 * Windows treats these stems as devices in any directory and with any
 * extension (`NUL.txt` is still NUL). The superscript digits are reserved too.
 */
const RESERVED_DEVICE_STEM = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i

/** `:` opens an alternate data stream; the rest are invalid in any NTFS name. */
const INVALID_NAME_CHARACTERS = /[<>:"/\\|?*\x00-\x1f]/
const INVALID_NAME_CHARACTERS_GLOBAL = new RegExp(INVALID_NAME_CHARACTERS.source, 'g')

function isReservedDeviceName(name: string): boolean {
  return RESERVED_DEVICE_STEM.test(name.split('.')[0].trimEnd())
}

/**
 * Whether `segment` names exactly the file it spells as one Windows path
 * component. Windows silently strips a trailing dot or space, reads `name:x`
 * as a stream of `name`, and opens a reserved device name as the device, so
 * each of those reaches something other than the file that was checked.
 */
export function isWin32SafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    !INVALID_NAME_CHARACTERS.test(segment) &&
    !/[. ]$/.test(segment) &&
    !isReservedDeviceName(segment)
  )
}

/** Rewrites an untrusted file name into one Windows stores under exactly that name. */
export function toWin32SafeFileName(name: string): string {
  const replaced = name.replace(INVALID_NAME_CHARACTERS_GLOBAL, '_').replace(/[. ]+$/, '')
  return isReservedDeviceName(replaced) ? `_${replaced}` : replaced
}

const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/
const HOME_RELATIVE = /^~[\\/]/

const DRIVE_PATH_REQUIRED = 'Use a drive path such as C:\\Users\\name\\file or a ~\\ path.'

/**
 * Resolves a model-supplied Windows path without touching the filesystem.
 *
 * It runs before any `realpath` or `stat`, because opening a UNC path
 * (`\\host\share`) makes Windows authenticate to that host and hands it the
 * user's NTLM hash before any consent dialog. Only a drive-absolute path or a
 * path under `~` is accepted, so UNC, `\\?\` and `\\.\` device paths,
 * drive-relative `C:foo`, and rooted `\foo` (relative to the current drive)
 * are all refused. UNC shares are refused outright, even inside a granted
 * share, until grants can be matched lexically. A drive letter the user
 * mapped to a share passes this check, since it reaches only the server the
 * user chose; the file backend refuses it once it resolves to the share. Each
 * segment must also pass {@link isWin32SafeSegment}.
 */
export function resolveWin32NativePath(value: string, home: string): string {
  const homeRelative = value === '~' ? '' : HOME_RELATIVE.test(value) ? value.slice(2) : null
  if (homeRelative === null && !DRIVE_ABSOLUTE.test(value)) throw new Error(DRIVE_PATH_REQUIRED)
  if (homeRelative !== null && /^[\\/]/.test(homeRelative)) throw new Error(DRIVE_PATH_REQUIRED)
  const segments = (homeRelative ?? value.slice(3)).split(/[\\/]/)
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') continue
    if (!isWin32SafeSegment(segment))
      throw new Error(`"${segment}" is not a plain Windows file or folder name.`)
  }
  const resolved = homeRelative === null ? win32.resolve(value) : win32.resolve(home, homeRelative)
  if (!DRIVE_ABSOLUTE.test(resolved)) throw new Error(DRIVE_PATH_REQUIRED)
  return resolved
}
