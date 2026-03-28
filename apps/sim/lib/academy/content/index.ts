import type { Course } from '@/lib/academy/types'
import { simFoundations } from './courses/sim-foundations'

/** All published courses in display order. */
export const COURSES: Course[] = [simFoundations]

const bySlug = new Map(COURSES.map((c) => [c.slug, c]))
const byId = new Map(COURSES.map((c) => [c.id, c]))

export function getCourse(slug: string): Course | undefined {
  return bySlug.get(slug)
}

export function getCourseById(id: string): Course | undefined {
  return byId.get(id)
}
