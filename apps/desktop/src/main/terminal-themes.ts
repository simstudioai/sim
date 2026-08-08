import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  cloneTerminalSelectedProfile,
  isTerminalSelectedProfile,
  TERMINAL_DARK_THEME,
  TERMINAL_LIGHT_THEME,
  TERMINAL_THEME_ANSI_KEYS,
  type TerminalThemeProfile,
} from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const execFileAsync = promisify(execFile)
const logger = createLogger('TerminalThemes')

const JXA_SCRIPT = `
ObjC.import('AppKit')

function clamp(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0
}

function hexComponent(value) {
  return Math.round(clamp(value) * 255).toString(16).padStart(2, '0')
}

function hex(red, green, blue) {
  return '#' + hexComponent(red) + hexComponent(green) + hexComponent(blue)
}

function appKitColor(profile, key, fallback) {
  try {
    const data = profile.objectForKey(key)
    if (!data) return fallback
    const archived = $.NSKeyedUnarchiver.unarchiveObjectWithData(data)
    const color = archived && archived.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace)
    if (!color) return fallback
    return hex(color.redComponent, color.greenComponent, color.blueComponent)
  } catch (_) {
    return fallback
  }
}

function dictionaryColor(value, fallback) {
  if (!value || typeof value !== 'object') return fallback
  const red = Number(value['Red Component'])
  const green = Number(value['Green Component'])
  const blue = Number(value['Blue Component'])
  if (![red, green, blue].every(Number.isFinite)) return fallback
  return hex(red, green, blue)
}

function isDark(color) {
  const red = parseInt(color.slice(1, 3), 16) / 255
  const green = parseInt(color.slice(3, 5), 16) / 255
  const blue = parseInt(color.slice(5, 7), 16) / 255
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.5
}

const LIGHT_THEME = ${JSON.stringify(TERMINAL_LIGHT_THEME)}
const DARK_THEME = ${JSON.stringify(TERMINAL_DARK_THEME)}
const PALETTE_KEYS = ${JSON.stringify(TERMINAL_THEME_ANSI_KEYS)}
const TERMINAL_ANSI_KEYS = [
  'ANSIBlackColor', 'ANSIRedColor', 'ANSIGreenColor', 'ANSIYellowColor', 'ANSIBlueColor',
  'ANSIMagentaColor', 'ANSICyanColor', 'ANSIWhiteColor', 'ANSIBrightBlackColor',
  'ANSIBrightRedColor', 'ANSIBrightGreenColor', 'ANSIBrightYellowColor', 'ANSIBrightBlueColor',
  'ANSIBrightMagentaColor', 'ANSIBrightCyanColor', 'ANSIBrightWhiteColor'
]

function terminalPalette(profile) {
  const background = appKitColor(profile, 'BackgroundColor', LIGHT_THEME.background)
  const dark = isDark(background)
  const fallback = dark ? DARK_THEME : LIGHT_THEME
  const palette = {
    background: background,
    foreground: appKitColor(profile, 'TextColor', fallback.foreground),
    cursor: appKitColor(profile, 'CursorColor', fallback.cursor),
    cursorAccent: background,
    selectionBackground: appKitColor(profile, 'SelectionColor', fallback.selectionBackground)
  }
  for (let index = 0; index < PALETTE_KEYS.length; index += 1) {
    const key = PALETTE_KEYS[index]
    palette[key] = appKitColor(profile, TERMINAL_ANSI_KEYS[index], fallback[key])
  }
  return palette
}

function itermColor(profile, key, suffix, fallback) {
  return dictionaryColor(profile[key + suffix], dictionaryColor(profile[key], fallback))
}

function itermPalette(profile, suffix) {
  const background = itermColor(profile, 'Background Color', suffix, LIGHT_THEME.background)
  const dark = isDark(background)
  const fallback = dark ? DARK_THEME : LIGHT_THEME
  const palette = {
    background: background,
    foreground: itermColor(profile, 'Foreground Color', suffix, fallback.foreground),
    cursor: itermColor(profile, 'Cursor Color', suffix, fallback.cursor),
    cursorAccent: itermColor(profile, 'Cursor Text Color', suffix, background),
    selectionBackground: itermColor(profile, 'Selection Color', suffix, fallback.selectionBackground),
    selectionForeground: itermColor(profile, 'Selected Text Color', suffix, fallback.foreground)
  }
  for (let index = 0; index < PALETTE_KEYS.length; index += 1) {
    const key = PALETTE_KEYS[index]
    palette[key] = itermColor(profile, 'Ansi ' + index + ' Color', suffix, fallback[key])
  }
  return palette
}

const profiles = []

try {
  const defaults = $.NSUserDefaults.alloc.initWithSuiteName('com.apple.Terminal')
  const settings = defaults.dictionaryForKey('Window Settings')
  const names = settings ? ObjC.deepUnwrap(settings.allKeys) : []
  for (const name of names) {
    const profile = settings.objectForKey(name)
    if (!profile) continue
    profiles.push({
      id: 'terminal:' + encodeURIComponent(name),
      name: String(name),
      source: 'terminal',
      palette: terminalPalette(profile)
    })
  }
} catch (_) {}

try {
  const defaults = $.NSUserDefaults.alloc.initWithSuiteName('com.googlecode.iterm2')
  const bookmarks = ObjC.deepUnwrap(defaults.arrayForKey('New Bookmarks')) || []
  for (const profile of bookmarks) {
    if (!profile || typeof profile !== 'object') continue
    const guid = String(profile.Guid || '')
    const name = String(profile.Name || '')
    if (!guid || !name) continue
    const result = {
      id: 'iterm2:' + encodeURIComponent(guid),
      name: name,
      source: 'iterm2',
      palette: itermPalette(profile, '')
    }
    const separateColors = profile['Use Separate Colors for Light and Dark Mode']
    if (separateColors === true || separateColors === 1) {
      result.lightPalette = itermPalette(profile, ' (Light)')
      result.darkPalette = itermPalette(profile, ' (Dark)')
    }
    profiles.push(result)
  }
} catch (_) {}

JSON.stringify(profiles)
`

/** Validates the color-only output of the macOS profile reader. */
export function parseTerminalThemeProfiles(value: unknown): TerminalThemeProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const profiles: TerminalThemeProfile[] = []
  for (const candidate of value) {
    if (!isTerminalSelectedProfile(candidate) || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    profiles.push(cloneTerminalSelectedProfile(candidate))
  }
  return profiles.sort(
    (left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name)
  )
}

async function readTerminalThemeProfiles(): Promise<TerminalThemeProfile[]> {
  if (process.platform !== 'darwin') return []
  const { stdout } = await execFileAsync(
    '/usr/bin/osascript',
    ['-l', 'JavaScript', '-e', JXA_SCRIPT],
    {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5_000,
    }
  )
  return parseTerminalThemeProfiles(JSON.parse(stdout))
}

let cachedProfiles: TerminalThemeProfile[] | null = null
let profileLoad: Promise<TerminalThemeProfile[]> | null = null

/** Reads current Terminal.app and iTerm2 profiles, coalescing concurrent requests. */
export async function listTerminalThemeProfiles(): Promise<TerminalThemeProfile[]> {
  profileLoad ??= readTerminalThemeProfiles()
    .then((profiles) => {
      cachedProfiles = profiles
      return profiles
    })
    .catch((error) => {
      logger.warn('Could not read terminal theme profiles', { error: getErrorMessage(error) })
      cachedProfiles = []
      return cachedProfiles
    })
    .finally(() => {
      profileLoad = null
    })
  return profileLoad
}

/** Resolves selection only from profiles already shown to the user. */
export function findCachedTerminalThemeProfile(
  profileId: string
): TerminalThemeProfile | undefined {
  return cachedProfiles?.find(({ id }) => id === profileId)
}
