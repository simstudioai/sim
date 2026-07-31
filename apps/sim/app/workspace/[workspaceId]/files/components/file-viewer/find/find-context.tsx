'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { generateId } from '@sim/utils/id'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { FileFindBar } from './find-bar'
import {
  DEFAULT_FIND_FLAGS,
  EMPTY_FIND_RESULT,
  type FindController,
  type FindResult,
  type FindResultReporter,
} from './types'

/** Builds a controller for a surface, given the reporter it pushes match counts through. */
export type FindControllerFactory = (report: FindResultReporter) => FindController

interface FileFindContextValue {
  isOpen: boolean
  query: string
  result: FindResult
  close: () => void
  setQuery: (query: string) => void
  next: () => void
  prev: () => void
  registerSurface: (id: string, controller: FindController) => () => void
  reportResult: (id: string, result: FindResult) => void
}

const FileFindContext = createContext<FileFindContextValue | null>(null)

/**
 * Find-highlight styling. `.file-find-match*` target Monaco and ProseMirror inline decoration spans;
 * the `::highlight(...)` pseudos target the CSS Custom Highlight API used by read-only DOM previews
 * (which supports only color properties, so the current match uses an inverted fill).
 */
const FIND_HIGHLIGHT_CSS = `
.file-find-match {
  background-color: var(--highlight-match-bg);
  color: var(--highlight-match-text);
  border-radius: 2px;
}
.file-find-match-current {
  background-color: var(--highlight-match-text);
  color: var(--highlight-match-bg);
  border-radius: 2px;
}
::highlight(file-find) {
  background-color: var(--highlight-match-bg);
  color: var(--highlight-match-text);
}
::highlight(file-find-current) {
  background-color: var(--highlight-match-text);
  color: var(--highlight-match-bg);
}
`

interface RegisteredSurface {
  controller: FindController
  /** Monotonic registration order; breaks priority ties toward the most recently mounted. */
  seq: number
}

/**
 * Scopes a find bar to the file viewer it wraps. `Cmd/Ctrl+F` opens the bar only while focus is inside
 * the viewer and a searchable surface is mounted; anywhere else the keypress falls through to the
 * browser's native find. Find-only, live (searches as you type), modeled on the Tables module's find.
 */
export function FileFindProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [result, setResult] = useState<FindResult>(EMPTY_FIND_RESULT)
  /** Bumped whenever the surface set changes, so the active-controller memo re-derives. */
  const [surfaceVersion, setSurfaceVersion] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const surfacesRef = useRef<Map<string, RegisteredSurface>>(null)
  surfacesRef.current ??= new Map()
  const seqRef = useRef(0)
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen

  // The active surface: highest priority (editor > read-only preview), most-recent on ties.
  const { activeController, activeId } = useMemo(() => {
    let best: RegisteredSurface | null = null
    let bestId: string | null = null
    for (const [id, entry] of surfacesRef.current!) {
      if (
        !best ||
        entry.controller.priority > best.controller.priority ||
        (entry.controller.priority === best.controller.priority && entry.seq > best.seq)
      ) {
        best = entry
        bestId = id
      }
    }
    return { activeController: best?.controller ?? null, activeId: bestId }
    // surfaceVersion is the reactive trigger; the ref itself is stable.
  }, [surfaceVersion])
  const activeControllerRef = useRef(activeController)
  activeControllerRef.current = activeController
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  const registerSurface = useCallback((id: string, controller: FindController) => {
    const seq = ++seqRef.current
    surfacesRef.current!.set(id, { controller, seq })
    setSurfaceVersion((v) => v + 1)
    return () => {
      const entry = surfacesRef.current!.get(id)
      if (entry?.controller === controller) {
        surfacesRef.current!.delete(id)
        controller.dispose()
        setSurfaceVersion((v) => v + 1)
      }
    }
  }, [])

  // Only the active surface's reports update the bar (guards a just-deactivated surface's stale write).
  const reportResult = useCallback((id: string, next: FindResult) => {
    if (activeIdRef.current === id) setResult(next)
  }, [])

  const setQuery = useCallback((next: string) => setQueryState(next), [])

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => {
    setIsOpen(false)
    setResult(EMPTY_FIND_RESULT)
    activeControllerRef.current?.search('', DEFAULT_FIND_FLAGS)
    activeControllerRef.current?.focusTarget()
  }, [])

  const next = useCallback(() => activeControllerRef.current?.next(), [])
  const prev = useCallback(() => activeControllerRef.current?.prev(), [])

  // Live search: re-run on every keystroke and whenever the active surface changes.
  useEffect(() => {
    if (!isOpen || !activeController) return
    activeController.search(query, DEFAULT_FIND_FLAGS)
  }, [isOpen, activeController, query])

  // If the active surface unmounts while open (file switch, mode change), drop the bar.
  useEffect(() => {
    if (isOpen && !activeController) {
      setIsOpen(false)
      setResult(EMPTY_FIND_RESULT)
    }
  }, [isOpen, activeController])

  // Cmd/Ctrl+F opens the bar ONLY while focus is inside this viewer and a searchable surface exists.
  // Otherwise the event falls through so the browser's native find works (the desired behavior outside
  // the Files viewer). Capture phase + stopPropagation keeps Monaco's own find widget from also firing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return
      const mod = isMacPlatform() ? e.metaKey : e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      const root = rootRef.current
      if (!root || !root.contains(document.activeElement)) return
      if (!activeControllerRef.current) return
      e.preventDefault()
      e.stopPropagation()
      if (isOpenRef.current) close()
      else open()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [close, open])

  const value = useMemo<FileFindContextValue>(
    () => ({ isOpen, query, result, close, setQuery, next, prev, registerSurface, reportResult }),
    [isOpen, query, result, close, setQuery, next, prev, registerSurface, reportResult]
  )

  return (
    <FileFindContext.Provider value={value}>
      <style>{FIND_HIGHLIGHT_CSS}</style>
      <div ref={rootRef} className='relative flex min-h-0 w-full flex-1 flex-col'>
        {children}
        {isOpen && activeController && <FileFindBar />}
      </div>
    </FileFindContext.Provider>
  )
}

export function useFileFind(): FileFindContextValue {
  const ctx = useContext(FileFindContext)
  if (!ctx) throw new Error('useFileFind must be used within a FileFindProvider')
  return ctx
}

/**
 * Registers the calling component as a searchable find surface. Pass the controller `factory` and any
 * `deps` that should rebuild the controller (e.g. the editor instance). `enabled` (default true) gates
 * registration — pass `false` while the surface is mounted but not actually visible (e.g. a Monaco
 * editor hidden behind a preview pane), so a dead controller never outranks the visible one. No-ops
 * outside a {@link FileFindProvider} — the read-only public share page renders the viewer without one.
 */
export function useRegisterFindController(
  factory: FindControllerFactory,
  deps: React.DependencyList,
  enabled = true
) {
  const ctx = useContext(FileFindContext)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const factoryRef = useRef(factory)
  factoryRef.current = factory
  const idRef = useRef<string | null>(null)
  idRef.current ??= generateId()

  // Depends only on the caller's own `deps` (+ `enabled`), never on the (per-render) context value, so
  // a re-render of the provider never re-registers the controller mid-search.
  useEffect(() => {
    if (!enabled) return
    const c = ctxRef.current
    if (!c) return
    const id = idRef.current!
    const controller = factoryRef.current((result) => ctxRef.current?.reportResult(id, result))
    return c.registerSurface(id, controller)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
}
