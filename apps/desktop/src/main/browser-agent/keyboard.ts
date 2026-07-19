/**
 * Keyboard machinery for `browser_press_key` and internal key dispatch:
 * parsing "Cmd+Shift+Z"-style combos and building the trusted CDP
 * keyDown/keyUp pair. Pure logic except {@link dispatchKeyCombo}.
 */
import type { WebContents } from 'electron'
import * as cdp from '@/main/browser-agent/cdp'
import { ToolError } from '@/main/browser-agent/errors'

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
}

export interface ParsedCombo extends KeyDescriptor {
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export function parseKeyCombo(combo: string): ParsedCombo {
  const parts = combo
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) throw new ToolError(`Unrecognized key: "${combo}"`)
  const modifiers = { ctrl: false, meta: false, shift: false, alt: false }
  const keyPart = parts[parts.length - 1]
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase()
    if (lower === 'control' || lower === 'ctrl') modifiers.ctrl = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') modifiers.meta = true
    else if (lower === 'shift') modifiers.shift = true
    else if (lower === 'alt' || lower === 'option') modifiers.alt = true
    else throw new ToolError(`Unrecognized modifier: "${part}"`)
  }
  const named = NAMED_KEYS[keyPart.toLowerCase()]
  if (named) return { ...named, ...modifiers }
  if (/^[a-zA-Z]$/.test(keyPart)) {
    const upper = keyPart.toUpperCase()
    const key = modifiers.shift ? upper : keyPart.toLowerCase()
    return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), ...modifiers }
  }
  if (/^[0-9]$/.test(keyPart)) {
    return { key: keyPart, code: `Digit${keyPart}`, keyCode: keyPart.charCodeAt(0), ...modifiers }
  }
  if (keyPart.length === 1) {
    return { key: keyPart, code: '', keyCode: keyPart.charCodeAt(0), ...modifiers }
  }
  throw new ToolError(`Unrecognized key: "${keyPart}"`)
}

/** CDP `Input` modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
function cdpModifiers(combo: ParsedCombo): number {
  return (combo.alt ? 1 : 0) | (combo.ctrl ? 2 : 0) | (combo.meta ? 4 : 0) | (combo.shift ? 8 : 0)
}

function editingCommandFor(combo: ParsedCombo): string | null {
  switch (combo.key.toLowerCase()) {
    case 'a':
      return 'selectAll'
    case 'c':
      return 'copy'
    case 'x':
      return 'cut'
    case 'v':
      return 'paste'
    case 'z':
      return combo.shift ? 'redo' : 'undo'
    default:
      return null
  }
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
    nativeVirtualKeyCode: combo.keyCode,
  }
  const printable = combo.key.length === 1 && !combo.ctrl && !combo.meta
  const text = combo.key === 'Enter' ? '\r' : printable ? combo.key : undefined
  const commands = macEditingCommands(combo, platform)
  const down: cdp.CdpKeyEvent = {
    ...base,
    type: text !== undefined ? 'keyDown' : 'rawKeyDown',
    ...(text !== undefined ? { text } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  }
  return [down, { ...base, type: 'keyUp' }]
}

/** Presses a combo through the trusted pipeline. Throws on CDP failure. */
export async function dispatchKeyCombo(contents: WebContents, combo: ParsedCombo): Promise<void> {
  const [down, up] = buildKeyDispatchPlan(combo)
  await cdp.dispatchKeyEvent(contents, down)
  await cdp.dispatchKeyEvent(contents, up)
}
