'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

/** An action the open page offers in search, such as New table on the Tables list. */
export interface PageCommand {
  id: string
  label: string
  run: () => void
}

interface PageCommandActions {
  register: (owner: string, commands: readonly PageCommand[]) => void
  unregister: (owner: string) => void
}

const Actions = createContext<PageCommandActions | null>(null)
const Commands = createContext<readonly PageCommand[]>([])

/** Holds the commands the mounted pages register, for search's "This page" group. */
export function PageCommandsProvider({ children }: { children: ReactNode }) {
  const [owners, setOwners] = useState<ReadonlyMap<string, readonly PageCommand[]>>(() => new Map())
  const register = useCallback((owner: string, commands: readonly PageCommand[]) => {
    setOwners((current) => new Map(current).set(owner, commands))
  }, [])
  const unregister = useCallback((owner: string) => {
    setOwners((current) => {
      if (!current.has(owner)) return current
      const next = new Map(current)
      next.delete(owner)
      return next
    })
  }, [])
  const actions = useMemo(() => ({ register, unregister }), [register, unregister])
  const commands = useMemo(() => [...owners.values()].flat(), [owners])
  return (
    <Actions.Provider value={actions}>
      <Commands.Provider value={commands}>{children}</Commands.Provider>
    </Actions.Provider>
  )
}

/**
 * Offers `commands` in search while the calling page is mounted. They re-register only when their
 * ids or labels change, and each runs its latest `run`, so a page can pass inline closures.
 */
export function usePageCommands(commands: readonly PageCommand[]) {
  const actions = useContext(Actions)
  const owner = useId()
  const latest = useRef(commands)
  latest.current = commands
  const offered = JSON.stringify(commands.map(({ id, label }) => [id, label]))
  useEffect(() => {
    if (!actions) return
    const entries = JSON.parse(offered) as [string, string][]
    actions.register(
      owner,
      entries.map(([id, label]) => ({
        id,
        label,
        run: () => latest.current.find((command) => command.id === id)?.run(),
      }))
    )
    return () => actions.unregister(owner)
  }, [actions, owner, offered])
}

/** What the mounted pages offer, in mount order. */
export function useRegisteredPageCommands() {
  return useContext(Commands)
}
