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
import type { IssueState } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import type { WorkspaceDataMode, WorkspaceTabFlags } from '@/platform/lib/workspace-navigation'

/**
 * What a reader changes in a workspace during one product session: example decisions on issues and
 * how far each list was read. Nothing leaves the browser tab, and a new fixture scenario starts a
 * fresh session.
 */
function useSessionState() {
  const [decisions, setDecisions] = useState<Readonly<Record<string, IssueState>>>({})
  const revealed = useRef<Map<string, number> | null>(null)
  revealed.current ??= new Map()
  const scrolled = useRef<Map<string, number> | null>(null)
  scrolled.current ??= new Map()
  const openGroups = useRef<Map<string, Readonly<Record<string, boolean>>> | null>(null)
  openGroups.current ??= new Map()
  /** The list most recently left, so a record's Back link restores only the list it came from. */
  const lastLeft = useRef<string | null>(null)
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
    openGroups: openGroups.current,
    lastLeft,
    historyTarget,
    decisions,
    setDecisions,
    revealed: revealed.current,
  }
}

const Session = createContext<ReturnType<typeof useSessionState> | null>(null)

const DataMode = createContext<WorkspaceDataMode>('fixture')

const NO_TAB_FLAGS: WorkspaceTabFlags = {}

const TabFlags = createContext<WorkspaceTabFlags>(NO_TAB_FLAGS)

interface WorkspaceSessionProps {
  /** Where this server's workspace data comes from, which decides the tabs it serves. */
  mode: WorkspaceDataMode
  /** The organization's rollout flags a tab depends on; a flag left out hides its tab. */
  tabFlags?: WorkspaceTabFlags
  children: ReactNode
}

export function WorkspaceSession({
  mode,
  tabFlags = NO_TAB_FLAGS,
  children,
}: WorkspaceSessionProps) {
  const state = useSessionState()
  return (
    <DataMode.Provider value={mode}>
      <TabFlags.Provider value={tabFlags}>
        <Session.Provider value={state}>{children}</Session.Provider>
      </TabFlags.Provider>
    </DataMode.Provider>
  )
}

/** The rollout flags that decide which flagged tabs this organization sees. */
export function useWorkspaceTabFlags() {
  return useContext(TabFlags)
}

/** Whether the workspace pages read example or live data on this server. */
export function useWorkspaceDataMode() {
  return useContext(DataMode)
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

/** Which of a list's groups the reader opened or closed, remembered so Back shows the same groups. */
export function useOpenGroups(key: string) {
  const { openGroups } = useSession()
  const [toggled, setToggled] = useState(() => openGroups.get(key) ?? {})
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    setShownKey(key)
    setToggled(openGroups.get(key) ?? {})
  }
  const toggle = useCallback(
    (group: string, open: boolean) =>
      setToggled((current) => {
        const next = { ...current, [group]: open }
        openGroups.set(key, next)
        return next
      }),
    [key, openGroups]
  )
  return [toggled, toggle] as const
}

/**
 * A page's reading position in the shell's scroller: recorded while the page shows, restored when
 * Back, Forward or a record's Back link returns to it. A new visit starts at the top.
 */
export function useScrollMemory<T extends HTMLElement>() {
  const { scrolled, historyTarget, lastLeft } = useSession()
  const node = useRef<T>(null)
  useLayoutEffect(() => {
    const path = window.location.pathname
    const viewport = node.current?.closest<HTMLElement>('[data-scroll-axis="vertical"]')
    if (!viewport) return
    // The router renders a Back or Forward inside the popstate dispatch, before later listeners run.
    const traversal = window.event?.type === 'popstate'
    if (historyTarget.current === path || traversal) {
      historyTarget.current = null
      const top = scrolled.get(path) ?? 0
      // Tells the shell, whose reset runs after this, that the page places itself.
      viewport.dataset.restoredScroll = path
      // After the router's own scroll into view for a link, and before the first paint.
      requestAnimationFrame(() => {
        viewport.scrollTop = top
      })
    } else {
      scrolled.set(path, 0)
    }
    // Removed as the page leaves, so the scroller's clamp to the next page never overwrites it.
    const record = () => scrolled.set(path, viewport.scrollTop)
    viewport.addEventListener('scroll', record, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', record)
      lastLeft.current = path
    }
  }, [historyTarget, lastLeft, scrolled])
  return node
}

/** A record's Back link: the list it came from restores its reading position, as Back does. */
export function useListReturn() {
  const { historyTarget, lastLeft } = useSession()
  return () => {
    const path = window.location.pathname
    const list = path.slice(0, path.lastIndexOf('/'))
    if (lastLeft.current === list) historyTarget.current = list
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
