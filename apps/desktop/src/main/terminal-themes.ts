import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  TerminalThemePalette,
  TerminalThemeProfile,
  TerminalThemeSource,
} from '@sim/desktop-bridge'
import { isRecordLike } from '@sim/utils/object'

const execFileAsync = promisify(execFile)

const REQUIRED_PALETTE_KEYS = [
  'background',
  'foreground',
  'cursor',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const satisfies readonly (keyof TerminalThemePalette)[]

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

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
  return hex(value['Red Component'], value['Green Component'], value['Blue Component'])
}

function isDark(color) {
  const red = parseInt(color.slice(1, 3), 16) / 255
  const green = parseInt(color.slice(3, 5), 16) / 255
  const blue = parseInt(color.slice(5, 7), 16) / 255
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.5
}

const LIGHT_ANSI = [
  '#24292e', '#d1242f', '#1a7f37', '#9a6700', '#0969da', '#8250df', '#1b7c83', '#6e7781',
  '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f'
]
const DARK_ANSI = [
  '#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
  '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc'
]
const PALETTE_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta',
  'brightCyan', 'brightWhite'
]
const TERMINAL_ANSI_KEYS = [
  'ANSIBlackColor', 'ANSIRedColor', 'ANSIGreenColor', 'ANSIYellowColor', 'ANSIBlueColor',
  'ANSIMagentaColor', 'ANSICyanColor', 'ANSIWhiteColor', 'ANSIBrightBlackColor',
  'ANSIBrightRedColor', 'ANSIBrightGreenColor', 'ANSIBrightYellowColor', 'ANSIBrightBlueColor',
  'ANSIBrightMagentaColor', 'ANSIBrightCyanColor', 'ANSIBrightWhiteColor'
]

function terminalPalette(profile) {
  const fallbackBackground = '#ffffff'
  const background = appKitColor(profile, 'BackgroundColor', fallbackBackground)
  const dark = isDark(background)
  const ansi = dark ? DARK_ANSI : LIGHT_ANSI
  const palette = {
    background: background,
    foreground: appKitColor(profile, 'TextColor', dark ? '#e6edf3' : '#1f2328'),
    cursor: appKitColor(profile, 'CursorColor', dark ? '#e6edf3' : '#1f2328'),
    cursorAccent: background,
    selectionBackground: appKitColor(profile, 'SelectionColor', dark ? '#264f78' : '#b4d5fe')
  }
  for (let index = 0; index < PALETTE_KEYS.length; index += 1) {
    palette[PALETTE_KEYS[index]] = appKitColor(profile, TERMINAL_ANSI_KEYS[index], ansi[index])
  }
  return palette
}

function itermPalette(profile) {
  const background = dictionaryColor(profile['Background Color'], '#ffffff')
  const dark = isDark(background)
  const ansi = dark ? DARK_ANSI : LIGHT_ANSI
  const palette = {
    background: background,
    foreground: dictionaryColor(profile['Foreground Color'], dark ? '#e6edf3' : '#1f2328'),
    cursor: dictionaryColor(profile['Cursor Color'], dark ? '#e6edf3' : '#1f2328'),
    cursorAccent: dictionaryColor(profile['Cursor Text Color'], background),
    selectionBackground: dictionaryColor(profile['Selection Color'], dark ? '#264f78' : '#b4d5fe'),
    selectionForeground: dictionaryColor(profile['Selected Text Color'], dark ? '#e6edf3' : '#1f2328')
  }
  for (let index = 0; index < PALETTE_KEYS.length; index += 1) {
    palette[PALETTE_KEYS[index]] = dictionaryColor(profile['Ansi ' + index + ' Color'], ansi[index])
  }
  return palette
}

const profiles = []

try {
  const defaults = $.NSUserDefaults.alloc.initWithSuiteName('com.apple.Terminal')
  const settings = defaults.dictionaryForKey('Window Settings')
  const defaultName = String(ObjC.unwrap(defaults.stringForKey('Default Window Settings')) || '')
  const names = settings ? ObjC.deepUnwrap(settings.allKeys) : []
  for (const name of names) {
    const profile = settings.objectForKey(name)
    if (!profile) continue
    profiles.push({
      id: 'terminal:' + encodeURIComponent(name),
      name: String(name),
      source: 'terminal',
      sourceLabel: 'Terminal',
      isDefault: String(name) === defaultName,
      palette: terminalPalette(profile)
    })
  }
} catch (_) {}

try {
  const defaults = $.NSUserDefaults.alloc.initWithSuiteName('com.googlecode.iterm2')
  const bookmarks = ObjC.deepUnwrap(defaults.arrayForKey('New Bookmarks')) || []
  const defaultGuid = String(ObjC.unwrap(defaults.stringForKey('Default Bookmark Guid')) || '')
  for (const profile of bookmarks) {
    if (!profile || typeof profile !== 'object') continue
    const guid = String(profile.Guid || '')
    const name = String(profile.Name || '')
    if (!guid || !name) continue
    profiles.push({
      id: 'iterm2:' + encodeURIComponent(guid),
      name: name,
      source: 'iterm2',
      sourceLabel: 'iTerm2',
      isDefault: guid === defaultGuid,
      palette: itermPalette(profile)
    })
  }
} catch (_) {}

JSON.stringify(profiles)
`

function isThemeSource(value: unknown): value is TerminalThemeSource {
  return value === 'terminal' || value === 'iterm2'
}

function isThemePalette(value: unknown): value is TerminalThemePalette {
  if (!isRecordLike(value)) return false
  for (const key of REQUIRED_PALETTE_KEYS) {
    if (typeof value[key] !== 'string' || !COLOR_PATTERN.test(value[key])) return false
  }
  for (const key of ['cursorAccent', 'selectionForeground'] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || !COLOR_PATTERN.test(value[key]))
    ) {
      return false
    }
  }
  return true
}

function parsePalette(value: unknown): TerminalThemePalette | null {
  return isThemePalette(value) ? value : null
}

/** Validates the color-only output of the macOS profile reader. */
export function parseTerminalThemeProfiles(value: unknown): TerminalThemeProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const profiles: TerminalThemeProfile[] = []
  for (const candidate of value) {
    if (!isRecordLike(candidate)) continue
    const { id, name, source, sourceLabel, isDefault } = candidate
    const palette = parsePalette(candidate.palette)
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      id.length > 300 ||
      seen.has(id) ||
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 200 ||
      !isThemeSource(source) ||
      typeof sourceLabel !== 'string' ||
      sourceLabel.length === 0 ||
      sourceLabel.length > 50 ||
      typeof isDefault !== 'boolean' ||
      !palette
    ) {
      continue
    }
    seen.add(id)
    profiles.push({ id, name, source, sourceLabel, isDefault, palette })
  }
  return profiles.sort(
    (left, right) =>
      left.sourceLabel.localeCompare(right.sourceLabel) ||
      Number(right.isDefault) - Number(left.isDefault) ||
      left.name.localeCompare(right.name)
  )
}

/** Reads installed Terminal.app and iTerm2 profiles without modifying either application. */
export async function listTerminalThemeProfiles(): Promise<TerminalThemeProfile[]> {
  if (process.platform !== 'darwin') return []
  try {
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
  } catch {
    return []
  }
}
