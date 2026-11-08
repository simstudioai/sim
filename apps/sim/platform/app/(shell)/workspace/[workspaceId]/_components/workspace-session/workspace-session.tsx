'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { IssueState } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'

/**
 * What a reader changes in a workspace during one product session: example decisions on issues,
 * refreshes, the new runs they brought in and how far each list was read. Nothing leaves the
 * browser tab, and a new fixture scenario starts a fresh session.
 */
function useSessionState() {
  const [decisions, setDecisions] = useState<Readonly<Record<string, IssueState>>>({})
  const [refreshedAt, setRefreshedAt] = useState<Readonly<Record<string, number>>>({})
  const [incomingShown, setIncomingShown] = useState(false)
  const revealed = useRef<Map<string, number> | null>(null)
  revealed.current ??= new Map()
  return {
    decisions,
    setDecisions,
    refreshedAt,
    setRefreshedAt,
    incomingShown,
    setIncomingShown,
    revealed: revealed.current,
  }
}

const Session = createContext<ReturnType<typeof useSessionState> | null>(null)

export function WorkspaceSession({ children }: { children: ReactNode }) {
  const state = useSessionState()
  return <Session.Provider value={state}>{children}</Session.Provider>
}

function useSession() {
  const session = useContext(Session)
  if (!session) throw new Error('Workspace pages render inside the workspace layout')
  return session
}

/** An issue's state after any decision made in this session. */
export function useIssueDecisions() {
  const { decisions, setDecisions } = useSession()
  const decide = useCallback(
    (issueId: string, state: IssueState) =>
      setDecisions((current) => ({ ...current, [issueId]: state })),
    [setDecisions]
  )
  return { decisions, decide }
}

/** When a page's data last refreshed in this session, keyed by the page. */
export function useSessionRefresh(page: string) {
  const { refreshedAt, setRefreshedAt } = useSession()
  return {
    refreshedAt: refreshedAt[page],
    refresh: (at: number) => setRefreshedAt((current) => ({ ...current, [page]: at })),
  }
}

export function useIncomingRuns() {
  const { incomingShown, setIncomingShown } = useSession()
  return { shown: incomingShown, show: () => setIncomingShown(true) }
}

/** How many records a paged list shows, remembered so Back returns to the same reading position. */
export function useRevealedCount(key: string, pageSize: number) {
  const { revealed } = useSession()
  const [count, setCount] = useState(() => revealed.get(key) ?? pageSize)
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    setShownKey(key)
    setCount(revealed.get(key) ?? pageSize)
  }
  const more = useCallback(() => {
    setCount((current) => {
      const next = current + pageSize
      revealed.set(key, next)
      return next
    })
  }, [key, pageSize, revealed])
  return [count, more] as const
}

function noSubscription() {
  return () => {}
}

/** The viewer's zone once hydrated; the server and the first client render agree on UTC. */
export function useViewerTimeZone() {
  return useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => 'UTC'
  )
}
