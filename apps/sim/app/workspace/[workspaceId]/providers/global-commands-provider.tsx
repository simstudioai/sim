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
import { useRouter } from 'next/navigation'

const logger = createLogger('GlobalCommands')

function isMacPlatform(): boolean {
  if (typeof window === 'undefined') return false
  return (
    /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ||
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  )
}

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

function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const isMac = isMacPlatform()
  const expectedCtrl = parsed.ctrl || (parsed.mod ? !isMac : false)
  const expectedMeta = parsed.meta || (parsed.mod ? isMac : false)
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key

  return (
    eventKey === parsed.key &&
    !!e.ctrlKey === !!expectedCtrl &&
    !!e.metaKey === !!expectedMeta &&
    !!e.shiftKey === !!parsed.shift &&
    !!e.altKey === !!parsed.alt
  )
}

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

  const value = useMemo<GlobalCommandsContextValue>(() => ({ register }), [register])

  return <GlobalCommandsContext.Provider value={value}>{children}</GlobalCommandsContext.Provider>
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
