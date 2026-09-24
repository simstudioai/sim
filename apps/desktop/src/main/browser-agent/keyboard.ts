/**
 * Keyboard machinery for `browser_press_key` and internal key dispatch:
 * parsing "Cmd+Shift+Z"-style combos and building the trusted CDP
 * keyDown/keyUp pair. Pure logic except {@link dispatchKeyCombo}.
 */
import { getErrorMessage } from '@sim/utils/errors'
import type { WebContents } from 'electron'
import * as cdp from '@/main/browser-agent/cdp'
import { ToolError } from '@/main/browser-agent/errors'

const applicationMenuIsolationDepth = new WeakMap<WebContents, number>()

interface KeyDescriptor {
  key: string
  code: string
  keyCode: number
}

const NAMED_KEYS: Record<string, KeyDescriptor> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  ',': { key: ',', code: 'Comma', keyCode: 188 },
  comma: { key: ',', code: 'Comma', keyCode: 188 },
  '.': { key: '.', code: 'Period', keyCode: 190 },
  period: { key: '.', code: 'Period', keyCode: 190 },
  '/': { key: '/', code: 'Slash', keyCode: 191 },
  ';': { key: ';', code: 'Semicolon', keyCode: 186 },
  "'": { key: "'", code: 'Quote', keyCode: 222 },
  '[': { key: '[', code: 'BracketLeft', keyCode: 219 },
  ']': { key: ']', code: 'BracketRight', keyCode: 221 },
  '\\': { key: '\\', code: 'Backslash', keyCode: 220 },
  '-': { key: '-', code: 'Minus', keyCode: 189 },
  '=': { key: '=', code: 'Equal', keyCode: 187 },
  '`': { key: '`', code: 'Backquote', keyCode: 192 },
  plus: { key: '+', code: 'Equal', keyCode: 187 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  ctrl: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  option: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  cmd: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  command: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `f${index + 1}`,
      { key: `F${index + 1}`, code: `F${index + 1}`, keyCode: 112 + index },
    ])
  ),
}

const SHIFTED_CHARACTERS: Record<string, string> = {
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '`': '~',
}

const BASE_CHARACTER_DESCRIPTORS: Record<string, KeyDescriptor> = Object.fromEntries(
  Object.values(NAMED_KEYS)
    .filter((descriptor) => descriptor.key.length === 1)
    .map((descriptor) => [descriptor.key, descriptor])
)
for (let digit = 0; digit <= 9; digit++) {
  const key = String(digit)
  BASE_CHARACTER_DESCRIPTORS[key] = {
    key,
    code: `Digit${key}`,
    keyCode: key.charCodeAt(0),
  }
}
const BASE_FOR_SHIFTED_CHARACTER: Record<string, string> = Object.fromEntries(
  Object.entries(SHIFTED_CHARACTERS).map(([base, shifted]) => [shifted, base])
)

/** Modifier keys in the order a chord presses them, each with the flag its key-down sets. */
const MODIFIER_KEYS: readonly { flag: keyof KeyModifiers; descriptor: KeyDescriptor }[] = [
  { flag: 'ctrl', descriptor: NAMED_KEYS.control },
  { flag: 'alt', descriptor: NAMED_KEYS.alt },
  { flag: 'shift', descriptor: NAMED_KEYS.shift },
  { flag: 'meta', descriptor: NAMED_KEYS.meta },
]

export interface KeyModifiers {
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface ParsedCombo extends KeyDescriptor, KeyModifiers {}

export class KeyDispatchError extends Error {
  constructor(
    message: string,
    readonly keyDownDispatched: boolean
  ) {
    super(message)
    this.name = 'KeyDispatchError'
  }
}

export function parseKeyCombo(
  combo: string,
  platform: NodeJS.Platform = process.platform
): ParsedCombo {
  const trimmedCombo = combo.trim()
  const parts =
    trimmedCombo === '+'
      ? ['+']
      : trimmedCombo.endsWith('++')
        ? [
            ...trimmedCombo
              .slice(0, -2)
              .split('+')
              .map((part) => part.trim())
              .filter(Boolean),
            '+',
          ]
        : trimmedCombo
            .split('+')
            .map((part) => part.trim())
            .filter(Boolean)
  if (parts.length === 0) throw new ToolError(`Unrecognized key: "${combo}"`)
  const modifiers = parseModifiers(parts.slice(0, -1), platform)
  const keyPart = parts[parts.length - 1]
  const named = NAMED_KEYS[keyPart.toLowerCase()]
  const ownModifier = named && MODIFIER_KEYS.find((modifier) => modifier.descriptor === named)
  if (ownModifier) modifiers[ownModifier.flag] = true
  if (named) {
    const key = modifiers.shift ? (SHIFTED_CHARACTERS[named.key] ?? named.key) : named.key
    return { ...named, key, ...modifiers }
  }
  if (/^[a-zA-Z]$/.test(keyPart)) {
    const upper = keyPart.toUpperCase()
    const key = modifiers.shift ? upper : keyPart.toLowerCase()
    return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), ...modifiers }
  }
  if (/^[0-9]$/.test(keyPart)) {
    const key = modifiers.shift ? (SHIFTED_CHARACTERS[keyPart] ?? keyPart) : keyPart
    return { key, code: `Digit${keyPart}`, keyCode: keyPart.charCodeAt(0), ...modifiers }
  }
  if (keyPart.length === 1) {
    const base = BASE_FOR_SHIFTED_CHARACTER[keyPart]
    if (base) {
      const descriptor = BASE_CHARACTER_DESCRIPTORS[base]
      return { ...descriptor, key: keyPart, ...modifiers, shift: true }
    }
    return { key: keyPart, code: '', keyCode: keyPart.charCodeAt(0), ...modifiers }
  }
  throw new ToolError(`Unrecognized key: "${keyPart}"`)
}

/**
 * Parses modifier names ("Shift", "Cmd", "Mod", …). `Mod` is the platform's primary
 * shortcut modifier: Meta on macOS, Control elsewhere.
 */
export function parseModifiers(
  names: readonly string[],
  platform: NodeJS.Platform = process.platform
): KeyModifiers {
  const modifiers = { ctrl: false, meta: false, shift: false, alt: false }
  for (const name of names) {
    const lower = name.trim().toLowerCase()
    if (lower === 'control' || lower === 'ctrl') modifiers.ctrl = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') modifiers.meta = true
    else if (
      lower === 'mod' ||
      lower === 'primary' ||
      lower === 'controlormeta' ||
      lower === 'commandorcontrol'
    ) {
      if (platform === 'darwin') modifiers.meta = true
      else modifiers.ctrl = true
    } else if (lower === 'shift') modifiers.shift = true
    else if (lower === 'alt' || lower === 'option') modifiers.alt = true
    else throw new ToolError(`Unrecognized modifier: "${name}"`)
  }
  return modifiers
}

/** CDP `Input` modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function cdpModifiers(modifiers: KeyModifiers): number {
  return (
    (modifiers.alt ? 1 : 0) |
    (modifiers.ctrl ? 2 : 0) |
    (modifiers.meta ? 4 : 0) |
    (modifiers.shift ? 8 : 0)
  )
}

/**
 * Clipboard shortcuts are deliberately absent. Paste would let an agent move
 * the user's clipboard — which routinely holds a password copied out of a
 * password manager — into a page field, where the next snapshot reports it as
 * an ordinary `value`. Copy and cut would let it overwrite the clipboard. See
 * {@link comboTouchesClipboard}, which refuses them outright.
 */
function editingCommandFor(combo: ParsedCombo): string | null {
  switch (combo.key.toLowerCase()) {
    case 'a':
      return 'selectAll'
    case 'z':
      return combo.shift ? 'redo' : 'undo'
    default:
      return null
  }
}

/**
 * Whether a combo would drive the system clipboard. Checked before dispatch
 * rather than by withholding the CDP `commands` array: off macOS these are
 * Blink-native, so a key event alone still performs them.
 */
export function comboTouchesClipboard(combo: ParsedCombo): boolean {
  if (!combo.ctrl && !combo.meta) return false
  const key = combo.key.toLowerCase()
  return key === 'v' || key === 'c' || key === 'x'
}

/**
 * On macOS the editing shortcuts are bound in the system menu layer, which
 * CDP key events never traverse — so Blink must be told the editing command
 * explicitly (same technique as Puppeteer/Playwright). The model doesn't know
 * the host OS and often says "Control+A", so on macOS Ctrl is treated as Cmd
 * for these shortcuts: both must select all, not silently no-op. On other
 * platforms Ctrl+key is handled inside Blink and needs no help.
 */
function normalizeComboForPlatform(combo: ParsedCombo, platform: NodeJS.Platform): ParsedCombo {
  if (platform !== 'darwin' || !combo.ctrl || combo.meta || editingCommandFor(combo) === null) {
    return combo
  }
  return { ...combo, ctrl: false, meta: true }
}

function macEditingCommands(combo: ParsedCombo, platform: NodeJS.Platform): string[] {
  if (platform !== 'darwin' || !combo.meta) return []
  const command = editingCommandFor(combo)
  return command ? [command] : []
}

/**
 * The characters a combo would insert, or undefined when it only moves the
 * caret or triggers an editing command. Enter counts: it carries "\r" and
 * activates defaults such as form submission.
 */
function insertedTextFor(combo: ParsedCombo): string | undefined {
  if (combo.key === 'Enter') return '\r'
  const printable = combo.key.length === 1 && !combo.ctrl && !combo.meta && !combo.alt
  return printable ? combo.key : undefined
}

/**
 * Builds the trusted keyDown/keyUp pair for a combo. Printable keys without
 * ctrl/meta carry `text` so Blink inserts the character; Enter carries "\r"
 * so it activates defaults (form submission, newline). Everything else is a
 * rawKeyDown, which still drives Blink's default editing actions (Backspace
 * deletes, arrows move the caret, Ctrl/Cmd+A selects all).
 */
export function buildKeyDispatchPlan(
  rawCombo: ParsedCombo,
  platform: NodeJS.Platform = process.platform
): [cdp.CdpKeyEvent, cdp.CdpKeyEvent] {
  const combo = normalizeComboForPlatform(rawCombo, platform)
  const modifiers = cdpModifiers(combo)
  const base = {
    modifiers,
    key: combo.key,
    code: combo.code,
    windowsVirtualKeyCode: combo.keyCode,
  }
  const text = insertedTextFor(combo)
  const commands = macEditingCommands(combo, platform)
  const down: cdp.CdpKeyEvent = {
    ...base,
    type: text !== undefined ? 'keyDown' : 'rawKeyDown',
    ...(text !== undefined ? { text } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  }
  return [down, { ...base, type: 'keyUp' }]
}

/**
 * The separate modifier key presses around a chord's main key: a real keyboard sends Control, then
 * Shift, then Y, and releases in reverse, so pages that track held keys see each modifier. Each
 * key-down carries the modifiers held so far, and each key-up the ones still held.
 */
export function modifierKeyEvents(
  rawCombo: ParsedCombo,
  platform: NodeJS.Platform = process.platform
): { downs: cdp.CdpKeyEvent[]; ups: cdp.CdpKeyEvent[] } {
  const combo = normalizeComboForPlatform(rawCombo, platform)
  const held = { ctrl: false, meta: false, shift: false, alt: false }
  const downs: cdp.CdpKeyEvent[] = []
  const ups: cdp.CdpKeyEvent[] = []
  for (const { flag, descriptor } of MODIFIER_KEYS) {
    if (!combo[flag] || descriptor.key === combo.key) continue
    held[flag] = true
    const event = {
      key: descriptor.key,
      code: descriptor.code,
      windowsVirtualKeyCode: descriptor.keyCode,
    }
    downs.push({ ...event, type: 'rawKeyDown', modifiers: cdpModifiers(held) })
    ups.unshift({ ...event, type: 'keyUp', modifiers: 0 })
  }
  let remaining = { ...held }
  for (const up of ups) {
    const flag = MODIFIER_KEYS.find((modifier) => modifier.descriptor.key === up.key)?.flag
    if (flag) remaining = { ...remaining, [flag]: false }
    up.modifiers = cdpModifiers(remaining)
  }
  return { downs, ups }
}

/**
 * Presses a combo through the trusted pipeline. Throws on CDP failure.
 *
 * Electron normally lets modified key events escape a focused WebContents to
 * application-menu accelerators. Agent input must stay inside the browser — a
 * page-level Cmd shortcut must never reload, close, or open a native window in
 * Sim — so menu handling is suspended for the complete CDP down/up pair. The
 * depth counter keeps overlapping tool calls from re-enabling it too early.
 */
export async function dispatchKeyCombo(contents: WebContents, combo: ParsedCombo): Promise<void> {
  const [down, up] = buildKeyDispatchPlan(combo)
  const modifierKeys = modifierKeyEvents(combo)
  const isolatesApplicationMenu = combo.ctrl || combo.meta || combo.alt
  if (isolatesApplicationMenu) {
    const depth = applicationMenuIsolationDepth.get(contents) ?? 0
    if (depth === 0) contents.setIgnoreMenuShortcuts(true)
    applicationMenuIsolationDepth.set(contents, depth + 1)
  }
  let keyDownDispatched = false
  try {
    // Mark before awaiting: Blink may receive the key-down and then lose the
    // CDP acknowledgement during navigation/process swap. In that ambiguous
    // case cleanup is required and a synthetic retry could double-act.
    keyDownDispatched = true
    for (const event of modifierKeys.downs) await cdp.dispatchKeyEvent(contents, event)
    await cdp.dispatchKeyEvent(contents, down)
    await cdp.dispatchKeyEvent(contents, up)
    for (const event of modifierKeys.ups) await cdp.dispatchKeyEvent(contents, event)
  } catch (error) {
    if (keyDownDispatched && !contents.isDestroyed()) {
      // Like pointer cleanup, this is best effort. The original key-up may
      // have reached Blink before its CDP response was lost; a duplicate
      // release is harmless, while omitting it can leave input state stuck.
      for (const release of [up, ...modifierKeys.ups]) {
        await cdp.dispatchKeyEvent(contents, release).catch(() => {})
      }
    }
    throw new KeyDispatchError(
      getErrorMessage(error, 'Trusted key dispatch failed'),
      keyDownDispatched
    )
  } finally {
    if (isolatesApplicationMenu) {
      const depth = applicationMenuIsolationDepth.get(contents) ?? 1
      if (depth > 1) {
        applicationMenuIsolationDepth.set(contents, depth - 1)
      } else {
        applicationMenuIsolationDepth.delete(contents)
        if (!contents.isDestroyed()) {
          // Menu restoration is cleanup, not evidence that page input failed.
          // Never let a synchronous Electron cleanup error cause the driver to
          // retry a key that may already have reached the page.
          try {
            contents.setIgnoreMenuShortcuts(false)
          } catch {}
        }
      }
    }
  }
}
