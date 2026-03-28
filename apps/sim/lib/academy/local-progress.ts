import { BrowserStorage } from '@/lib/core/utils/browser-storage'

const STORAGE_KEY = 'academy:completed'

export function getCompletedLessons(): Set<string> {
  return new Set(BrowserStorage.getItem<string[]>(STORAGE_KEY, []))
}

export function markLessonComplete(lessonId: string): void {
  const ids = getCompletedLessons()
  ids.add(lessonId)
  BrowserStorage.setItem(STORAGE_KEY, [...ids])
}
