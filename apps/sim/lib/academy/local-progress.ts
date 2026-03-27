import { createLogger } from '@sim/logger'

const logger = createLogger('AcademyProgress')
const STORAGE_KEY = 'academy:completed'

/** Returns the set of completed lesson IDs stored in localStorage. */
export function getCompletedLessons(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const ids: string[] = raw ? JSON.parse(raw) : []
    return new Set(ids)
  } catch (error) {
    logger.warn('Failed to read lesson progress from localStorage', { error })
    return new Set()
  }
}

/** Marks a lesson as completed in localStorage. */
export function markLessonComplete(lessonId: string): void {
  try {
    const ids = getCompletedLessons()
    ids.add(lessonId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch (error) {
    logger.warn('Failed to persist lesson completion', { lessonId, error })
  }
}
