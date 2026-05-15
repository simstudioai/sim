import { BrowserStorage } from '@/lib/core/utils/browser-storage'

const STORAGE_KEY = 'academy:completed'
const STORAGE_CHANGE_EVENT = 'academy:completed-lessons-change'
const SNAPSHOT_SEPARATOR = '\0'

export function getCompletedLessons(): Set<string> {
  return new Set(BrowserStorage.getItem<string[]>(STORAGE_KEY, []))
}

export function getCompletedLessonsSnapshot(): string {
  return [...getCompletedLessons()].sort().join(SNAPSHOT_SEPARATOR)
}

export function getServerCompletedLessonsSnapshot(): string {
  return ''
}

export function getCompletedLessonsFromSnapshot(snapshot: string): Set<string> {
  return new Set(snapshot ? snapshot.split(SNAPSHOT_SEPARATOR) : [])
}

export function subscribeToCompletedLessons(onStoreChange: () => void): () => void {
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      onStoreChange()
    }
  }

  window.addEventListener('storage', handleStorageChange)
  window.addEventListener(STORAGE_CHANGE_EVENT, onStoreChange)

  return () => {
    window.removeEventListener('storage', handleStorageChange)
    window.removeEventListener(STORAGE_CHANGE_EVENT, onStoreChange)
  }
}

export function markLessonComplete(lessonId: string): void {
  const ids = getCompletedLessons()
  ids.add(lessonId)
  BrowserStorage.setItem(STORAGE_KEY, [...ids])
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STORAGE_CHANGE_EVENT))
  }
}
