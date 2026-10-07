import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const HISTORY_INDEX = '__simSettingsIndex'
const HISTORY_GENERATION = '__simSettingsGeneration'
const TRACKER_INSTALLED = Symbol.for('sim.settings.historyTracker')
const logger = createLogger('SettingsBrowserNavigation')

interface TrackedHistory extends History {
  [TRACKER_INSTALLED]?: boolean
}

/**
 * Installs one document-lifetime tracker. Keeping the same wrappers through root
 * effect remounts also keeps Next's captured history methods valid.
 */
function installBrowserNavigationGuard() {
  const history: TrackedHistory = window.history
  if (history[TRACKER_INSTALLED]) return
  history[TRACKER_INSTALLED] = true
  const originalPush = history.pushState
  const originalReplace = history.replaceState
  const originalGo = history.go
  const navigation = window.navigation as typeof window.navigation | undefined
  const initialState = toRecord(history.state)
  let generation =
    typeof initialState[HISTORY_GENERATION] === 'string'
      ? initialState[HISTORY_GENERATION]
      : generateId()
  const entryIndex = (data: unknown): number | null => {
    if (navigation?.currentEntry) return navigation.currentEntry.index
    const state = toRecord(data)
    return state[HISTORY_GENERATION] === generation && typeof state[HISTORY_INDEX] === 'number'
      ? state[HISTORY_INDEX]
      : null
  }
  let currentIndex: number | null = entryIndex(history.state) ?? 0
  let restoring = false
  let pendingDelta = 0
  let allowTraversal = false
  let warnedUnindexed = false
  let currentUrl = new URL(window.location.href)
  const trackedRoutes = new Map<number, string>()
  const route = (url: URL) => url.pathname + url.search

  const stamp = (data: unknown, index: number, entryGeneration = generation) =>
    data == null || isRecordLike(data)
      ? { ...toRecord(data), [HISTORY_INDEX]: index, [HISTORY_GENERATION]: entryGeneration }
      : data

  originalReplace.call(history, stamp(history.state, currentIndex), '', window.location.href)
  trackedRoutes.set(currentIndex, route(currentUrl))

  history.pushState = (data: unknown, unused, url) => {
    const previousIndex = entryIndex(history.state)
    const nextGeneration = previousIndex === null ? generateId() : generation
    const nextIndex = (previousIndex ?? -1) + 1
    originalPush.call(history, stamp(data, nextIndex, nextGeneration), unused, url)
    if (generation !== nextGeneration) trackedRoutes.clear()
    generation = nextGeneration
    currentIndex = nextIndex
    currentUrl = new URL(window.location.href)
    for (const index of trackedRoutes.keys()) {
      if (index > nextIndex || index < nextIndex - history.length + 1) trackedRoutes.delete(index)
    }
    trackedRoutes.set(nextIndex, route(currentUrl))
  }
  history.replaceState = (data: unknown, unused, url) => {
    const index = entryIndex(history.state)
    originalReplace.call(history, index === null ? data : stamp(data, index), unused, url)
    currentIndex = index
    currentUrl = new URL(window.location.href)
    if (index !== null) trackedRoutes.set(index, route(currentUrl))
  }

  history.go = (delta) => {
    if (!delta) {
      originalGo.call(history, delta)
      return
    }
    const sourceIndex = entryIndex(history.state)
    const targetIndex = sourceIndex === null ? null : sourceIndex + delta
    const target = navigation?.entries().find((entry) => entry.index === targetIndex)
    const targetRoute = navigation
      ? target?.sameDocument && target.url
        ? route(new URL(target.url))
        : undefined
      : targetIndex === null
        ? undefined
        : trackedRoutes.get(targetIndex)
    const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
    if (targetRoute === route(new URL(window.location.href)) || (!isDirty && !navigationBlocked)) {
      originalGo.call(history, delta)
      return
    }
    requestLeave(() => {
      pendingDelta = delta
      allowTraversal = true
      originalGo.call(history, delta)
    })
  }
  history.back = () => history.go(-1)
  history.forward = () => history.go(1)

  window.addEventListener(
    'popstate',
    (event) => {
      const index = entryIndex(event.state)
      const destinationUrl = new URL(window.location.href)
      if (index !== null) trackedRoutes.set(index, route(destinationUrl))
      if (
        allowTraversal &&
        (index === null || currentIndex === null || index - currentIndex === pendingDelta)
      ) {
        currentIndex = index ?? (currentIndex === null ? null : currentIndex + pendingDelta)
        allowTraversal = false
        restoring = false
        currentUrl = destinationUrl
        if (index === null && currentIndex !== null)
          history.replaceState(event.state, '', window.location.href)
        return
      }
      allowTraversal = false
      if (
        !restoring &&
        destinationUrl.pathname === currentUrl.pathname &&
        destinationUrl.search === currentUrl.search
      ) {
        currentIndex = index
        currentUrl = destinationUrl
        return
      }
      if (index === null || currentIndex === null) {
        currentIndex = index
        currentUrl = destinationUrl
        restoring = false
        pendingDelta = 0
        if (!warnedUnindexed && index === null) {
          warnedUnindexed = true
          logger.warn('Cannot guard unindexed native history without the Navigation API')
        }
        return
      }
      const delta = index - currentIndex
      if (restoring) {
        event.stopImmediatePropagation()
        if (delta !== 0) {
          originalGo.call(history, -delta)
          return
        }
        restoring = false
        const requestedDelta = pendingDelta
        useSettingsDirtyStore.getState().requestLeave(() => {
          allowTraversal = true
          originalGo.call(history, requestedDelta)
        })
        return
      }
      const { isDirty, navigationBlocked } = useSettingsDirtyStore.getState()
      if (!delta || (!isDirty && !navigationBlocked)) {
        currentIndex = index
        currentUrl = destinationUrl
        allowTraversal = false
        return
      }
      event.stopImmediatePropagation()
      pendingDelta = delta
      restoring = true
      originalGo.call(history, -delta)
    },
    true
  )
}

/**
 * Protects refresh, programmatic traversal, and indexed native Back/Forward.
 * Without the Navigation API, unindexed native entries (including legacy entries)
 * cannot be guarded: popstate does not expose their traversal direction.
 */
export function useSettingsBrowserNavigation() {
  const shouldBlock = useSettingsDirtyStore((state) => state.isDirty || state.navigationBlocked)
  useEffect(installBrowserNavigationGuard, [])
  useEffect(() => {
    if (!shouldBlock) return
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [shouldBlock])
}
