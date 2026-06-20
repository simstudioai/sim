'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { isMacPlatform } from '@/lib/core/utils/platform'

const logger = createLogger('GlobalCommands')

export interface ParsedShortcut {
  key: string
  mod?: boolean
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export interface GlobalCommand {
  id?: string
  shortcut: string
  allowInEditable?: boolean
  handler: (event: KeyboardEvent) => void
}

interface RegistryCommand extends GlobalCommand {
  id: string
  parsed: ParsedShortcut
}

interface GlobalCommandsContextValue {
  register: (commands: GlobalCommand[]) => () => void
  invoke: (id: string) => boolean
}

const GlobalCommandsContext = createContext<GlobalCommandsContextValue | null>(null)

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+').map((p) => p.trim())
  const modifiers = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()))
  const last = parts[parts.length - 1]

  return {
    key: last.length === 1 ? last.toLowerCase() : last,
    mod: modifiers.has('mod'),
    ctrl: modifiers.has('ctrl'),
    meta: modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command'),
    shift: modifiers.has('shift'),
    alt: modifiers.has('alt') || modifiers.has('option'),
  }
}

/**
 * Maps a KeyboardEvent.code value to the logical key name used in shortcut definitions.
 * Needed for international keyboard layouts where e.key may produce unexpected characters
 * (e.g. macOS Option+letter yields 'å' instead of 'a', dead keys yield 'Dead').
 */
function codeToKey(code: string): string | undefined {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  return undefined
}

function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const isMac = isMacPlatform()
  const expectedCtrl = parsed.ctrl || (parsed.mod ? !isMac : false)
  const expectedMeta = parsed.meta || (parsed.mod ? isMac : false)
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const keyMatches = eventKey === parsed.key || codeToKey(e.code) === parsed.key

  return (
    keyMatches &&
    !!e.ctrlKey === !!expectedCtrl &&
    !!e.metaKey === !!expectedMeta &&
    !!e.shiftKey === !!parsed.shift &&
    !!e.altKey === !!parsed.alt
  )
}

/** Platform-resolved signature of a shortcut, so `Mod+K`, `Cmd+K`, and `Meta+K` compare equal on mac. */
function shortcutSignature(parsed: ParsedShortcut, isMac: boolean): string {
  const ctrl = parsed.ctrl || (parsed.mod ? !isMac : false)
  const meta = parsed.meta || (parsed.mod ? isMac : false)
  return `${parsed.key}|${+ctrl}|${+meta}|${+!!parsed.shift}|${+!!parsed.alt}`
}

/**
 * Whether the focused element (or an ancestor) declares it owns `parsed` via a comma-separated
 * `data-owned-shortcuts` attribute (e.g. a rich-text editor that binds `Mod+K` to links). Such a
 * shortcut is left for that element to handle instead of firing the global command.
 */
function focusedElementOwnsShortcut(parsed: ParsedShortcut, isMac: boolean): boolean {
  const active = document.activeElement
  const owner = active instanceof HTMLElement ? active.closest('[data-owned-shortcuts]') : null
  if (!owner) return false
  const target = shortcutSignature(parsed, isMac)
  return (owner.getAttribute('data-owned-shortcuts') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => shortcutSignature(parseShortcut(entry), isMac) === target)
}

export function GlobalCommandsProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<Map<string, RegistryCommand>>(new Map())
  const isMac = useMemo(() => isMacPlatform(), [])
  const router = useRouter()

  const register = useCallback((commands: GlobalCommand[]) => {
    const createdIds: string[] = []
    for (const cmd of commands) {
      const id = cmd.id ?? generateId()
      const parsed = parseShortcut(cmd.shortcut)
      registryRef.current.set(id, {
        ...cmd,
        id,
        parsed,
        allowInEditable: cmd.allowInEditable ?? true,
      })
      createdIds.push(id)
    }

    return () => {
      for (const id of createdIds) {
        registryRef.current.delete(id)
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return

      for (const [, cmd] of registryRef.current) {
        if (!cmd.allowInEditable) {
          const ae = document.activeElement
          const isEditable =
            ae instanceof HTMLInputElement ||
            ae instanceof HTMLTextAreaElement ||
            ae?.hasAttribute('contenteditable')
          if (isEditable) continue
        }

        if (matchesShortcut(e, cmd.parsed)) {
          if (focusedElementOwnsShortcut(cmd.parsed, isMac)) continue
          e.preventDefault()
          e.stopPropagation()
          try {
            cmd.handler(e)
          } catch (err) {
            logger.error('Global command handler threw', { id: cmd.id, err })
          }
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [isMac, router])

  const invoke = useCallback((id: string): boolean => {
    const cmd = registryRef.current.get(id)
    if (!cmd) return false
    try {
      cmd.handler(new KeyboardEvent('keydown'))
    } catch (err) {
      logger.error('Global command handler threw', { id, err })
    }
    return true
  }, [])

  const value = useMemo<GlobalCommandsContextValue>(
    () => ({ register, invoke }),
    [register, invoke]
  )

  return <GlobalCommandsContext.Provider value={value}>{children}</GlobalCommandsContext.Provider>
}

/**
 * Returns a function that runs a registered global command by id, mirroring its
 * keyboard shortcut exactly. Returns `false` when no command with that id is
 * currently registered (e.g. a workflow-only command invoked off-canvas), so
 * callers can offer the action safely without knowing what is mounted.
 */
export function useInvokeGlobalCommand(): (id: string) => boolean {
  const ctx = useContext(GlobalCommandsContext)
  if (!ctx) {
    throw new Error('useInvokeGlobalCommand must be used within GlobalCommandsProvider')
  }
  return ctx.invoke
}

export function useRegisterGlobalCommands(commands: GlobalCommand[] | (() => GlobalCommand[])) {
  const ctx = useContext(GlobalCommandsContext)
  if (!ctx) {
    throw new Error('useRegisterGlobalCommands must be used within GlobalCommandsProvider')
  }

  const commandsRef = useRef<GlobalCommand[]>([])
  const list = typeof commands === 'function' ? commands() : commands
  commandsRef.current = list

  useEffect(() => {
    const wrappedCommands = commandsRef.current.map((cmd) => ({
      ...cmd,
      handler: (event: KeyboardEvent) => {
        const currentCmd = commandsRef.current.find((c) => c.id === cmd.id)
        if (currentCmd) {
          currentCmd.handler(event)
        }
      },
    }))
    const unregister = ctx.register(wrappedCommands)
    return unregister
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
