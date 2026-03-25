import type { Course, Lesson } from '@/lib/academy/types'
import { simFoundations } from './courses/sim-foundations'

/** All published courses in display order. */
export const COURSES: Course[] = [simFoundations]

export function getCourse(slug: string): Course | undefined {
  return COURSES.find((c) => c.slug === slug)
}

export function getAllLessons(): Lesson[] {
  return COURSES.flatMap((c) => c.modules.flatMap((m) => m.lessons))
}
