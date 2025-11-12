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
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('GlobalCommands')

/**
 * Detects if the current platform is macOS.
 *
 * @returns True if running on macOS, false otherwise
 */
function isMacPlatform(): boolean {
  if (typeof window === 'undefined') return false
  return (
    /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ||
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  )
}

/**
 * Represents a parsed keyboard shortcut.
 *
 * We support the following modifiers:
 * - Mod: maps to Meta on macOS, Ctrl on other platforms
 * - Ctrl, Meta, Shift, Alt
 *
 * Examples:
 * - "Mod+A"
 * - "Mod+Shift+T"
 * - "Meta+K"
 */
export interface ParsedShortcut {
  key: string
  mod?: boolean
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

/**
 * Declarative command registration.
 */
export interface GlobalCommand {
  /** Unique id for the command. If omitted, one is generated. */
  id?: string
  /** Shortcut string in the form "Mod+Shift+T", "Mod+A", "Meta+K", etc. */
  shortcut: string
  /**
   * Whether to allow the command to run inside editable elements like inputs,
   * textareas or contenteditable. Defaults to true to ensure browser defaults
   * are overridden when desired.
   */
  allowInEditable?: boolean
  /**
   * Handler invoked when the shortcut is matched. Use this to trigger actions
   * like navigation or dispatching application events.
   */
  handler: (event: KeyboardEvent) => void
}

interface RegistryCommand extends GlobalCommand {
  id: string
  parsed: ParsedShortcut
}

interface GlobalCommandsContextValue {
  register: (commands: GlobalCommand[]) => () => void
}

const GlobalCommandsContext = createContext<GlobalCommandsContextValue | null>(null)

/**
 * Parses a human-readable shortcut into a structured representation.
 */
function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+').map((p) => p.trim())
  const modifiers = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()))
  const last = parts[parts.length - 1]

  return {
    key: last.length === 1 ? last.toLowerCase() : last, // keep non-letter keys verbatim
    mod: modifiers.has('mod'),
    ctrl: modifiers.has('ctrl'),
    meta: modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command'),
    shift: modifiers.has('shift'),
    alt: modifiers.has('alt') || modifiers.has('option'),
  }
}

/**
 * Checks if a KeyboardEvent matches a parsed shortcut, honoring platform-specific
 * interpretation of "Mod" (Meta on macOS, Ctrl elsewhere).
 */
function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const isMac = isMacPlatform()
  const expectedCtrl = parsed.ctrl || (parsed.mod ? !isMac : false)
  const expectedMeta = parsed.meta || (parsed.mod ? isMac : false)

  // Normalize key for comparison: for letters compare lowercase
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key

  return (
    eventKey === parsed.key &&
    !!e.ctrlKey === !!expectedCtrl &&
    !!e.metaKey === !!expectedMeta &&
    !!e.shiftKey === !!parsed.shift &&
    !!e.altKey === !!parsed.alt
  )
}

/**
 * Provider that captures global keyboard shortcuts and routes them to
 * registered commands. Commands can be registered from any descendant component.
 */
export function GlobalCommandsProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<Map<string, RegistryCommand>>(new Map())
  const isMac = useMemo(() => isMacPlatform(), [])
  const router = useRouter()

  const register = useCallback((commands: GlobalCommand[]) => {
    const createdIds: string[] = []
    for (const cmd of commands) {
      const id = cmd.id ?? crypto.randomUUID()
      const parsed = parseShortcut(cmd.shortcut)
      registryRef.current.set(id, {
        ...cmd,
        id,
        parsed,
        allowInEditable: cmd.allowInEditable ?? true,
      })
      createdIds.push(id)
      logger.info('Registered global command', { id, shortcut: cmd.shortcut })
    }

    return () => {
      for (const id of createdIds) {
        registryRef.current.delete(id)
        logger.info('Unregistered global command', { id })
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return

      // Evaluate matches in registration order (latest registration wins naturally
      // due to replacement on same id). Break on first match.
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
          // Always override default browser behavior for matched commands.
          e.preventDefault()
          e.stopPropagation()
          logger.info('Executing global command', {
            id: cmd.id,
            shortcut: cmd.shortcut,
            key: e.key,
            isMac,
            path: typeof window !== 'undefined' ? window.location.pathname : undefined,
          })
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

  const value = useMemo<GlobalCommandsContextValue>(() => ({ register }), [register])

  return <GlobalCommandsContext.Provider value={value}>{children}</GlobalCommandsContext.Provider>
}

/**
 * Registers a set of global commands for the lifetime of the component.
 *
 * Returns nothing; cleanup is automatic on unmount.
 */
export function useRegisterGlobalCommands(commands: GlobalCommand[] | (() => GlobalCommand[])) {
  const ctx = useContext(GlobalCommandsContext)
  if (!ctx) {
    throw new Error('useRegisterGlobalCommands must be used within GlobalCommandsProvider')
  }

  useEffect(() => {
    const list = typeof commands === 'function' ? commands() : commands
    const unregister = ctx.register(list)
    return unregister
    // We intentionally want to register once for the given commands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
