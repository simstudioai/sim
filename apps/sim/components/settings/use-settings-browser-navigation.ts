import { useEffect } from 'react'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const HISTORY_INDEX = '__simSettingsIndex'
const TRACKER_INSTALLED = Symbol.for('sim.settings.historyTracker')

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
  const navigation = (
    window as Window & { navigation?: { currentEntry: { index: number } | null } }
  ).navigation
  const storedIndex = navigation?.currentEntry?.index ?? toRecord(history.state)[HISTORY_INDEX]
  let currentIndex = typeof storedIndex === 'number' ? storedIndex : 0
  let restoring = false
  let pendingDelta = 0
  let allowTraversal = false

  const stamp = (data: unknown, index: number) =>
    data == null || isRecordLike(data) ? { ...toRecord(data), [HISTORY_INDEX]: index } : data

  history.pushState = (data: unknown, unused, url) => {
    const nextIndex = currentIndex + 1
    originalPush.call(history, stamp(data, nextIndex), unused, url)
    currentIndex = nextIndex
  }
  history.replaceState = (data: unknown, unused, url) => {
    originalReplace.call(history, stamp(data, currentIndex), unused, url)
  }
  history.replaceState(history.state, '', window.location.href)

  window.addEventListener(
    'popstate',
    (event) => {
      const storedIndex = navigation?.currentEntry?.index ?? toRecord(event.state)[HISTORY_INDEX]
      // Older unstamped entries precede the document's indexed navigation history.
      const index =
        typeof storedIndex === 'number'
          ? storedIndex
          : currentIndex + (allowTraversal ? pendingDelta : -1)
      const delta = index - currentIndex
      if (restoring) {
        event.stopImmediatePropagation()
        if (typeof storedIndex !== 'number') {
          pendingDelta--
          history.go(1)
          return
        }
        if (delta !== 0) {
          history.go(-delta)
          return
        }
        restoring = false
        const requestedDelta = pendingDelta
        useSettingsDirtyStore.getState().requestLeave(() => {
          allowTraversal = true
          history.go(requestedDelta)
        })
        return
      }
      const { isDirty, navigationBlocked } = useSettingsDirtyStore.getState()
      if (!delta || allowTraversal || (!isDirty && !navigationBlocked)) {
        currentIndex = index
        allowTraversal = false
        if (typeof storedIndex !== 'number')
          history.replaceState(event.state, '', window.location.href)
        return
      }
      event.stopImmediatePropagation()
      pendingDelta = delta
      restoring = true
      history.go(-delta)
    },
    true
  )
}

/** Protects refresh and Back/Forward for every registered settings editor. */
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
