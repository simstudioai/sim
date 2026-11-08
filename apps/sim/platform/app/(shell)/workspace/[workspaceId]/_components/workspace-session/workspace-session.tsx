'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  const scrolled = useRef<Map<string, number> | null>(null)
  scrolled.current ??= new Map()
  /** Where Back, Forward or a record's Back link is returning, until that page restores its position. */
  const historyTarget = useRef<string | null>(null)
  useEffect(() => {
    const onHistoryStep = () => {
      historyTarget.current = window.location.pathname
    }
    // For a destination rendered after the event; one rendered inside it is caught by `window.event`.
    window.addEventListener('popstate', onHistoryStep, { capture: true })
    return () => window.removeEventListener('popstate', onHistoryStep, { capture: true })
  }, [])
  return {
    scrolled: scrolled.current,
    historyTarget,
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

/**
 * Remembers a page's reading position in the shell's scroller when the reader leaves it by a click,
 * and restores it when Back or Forward returns. A new visit starts at the top.
 */
export function useScrollMemory<T extends HTMLElement>() {
  const { scrolled, historyTarget } = useSession()
  const node = useRef<T>(null)
  const scroller = () => node.current?.closest<HTMLElement>('[data-scroll-axis="vertical"]')
  useLayoutEffect(() => {
    const path = window.location.pathname
    const viewport = node.current?.closest<HTMLElement>('[data-scroll-axis="vertical"]')
    // The router renders a Back or Forward inside the popstate dispatch, before later listeners run.
    const traversal = window.event?.type === 'popstate'
    if (!viewport || (historyTarget.current !== path && !traversal)) return
    historyTarget.current = null
    const top = scrolled.get(path) ?? 0
    // Tells the shell, whose reset runs after this, that the page places itself.
    viewport.dataset.restoredScroll = path
    // After the router's own scroll into view for a link, and before the first paint.
    requestAnimationFrame(() => {
      viewport.scrollTop = top
    })
  }, [historyTarget, scrolled])
  const remember = () => {
    const viewport = scroller()
    if (viewport) scrolled.set(window.location.pathname, viewport.scrollTop)
  }
  return { ref: node, remember }
}

/** A record's Back link: the list it returns to restores its reading position, as Back does. */
export function useListReturn() {
  const { historyTarget } = useSession()
  return () => {
    const path = window.location.pathname
    historyTarget.current = path.slice(0, path.lastIndexOf('/'))
  }
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
