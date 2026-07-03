import type { CareerPosting } from '@/lib/ashby/jobs'
import { ALL_FILTER_VALUE } from '@/app/(landing)/careers/search-params'

export interface DepartmentGroup {
  department: string
  postings: CareerPosting[]
}

/**
 * Narrows postings to a selected Team and Location, treating {@link ALL_FILTER_VALUE}
 * as "any". Shared by the server-rendered fallback and the client board so a
 * deep-linked filter resolves to the exact same set on both sides.
 */
export function filterPostings(
  postings: CareerPosting[],
  team: string,
  location: string
): CareerPosting[] {
  return postings.filter(
    (posting) =>
      (team === ALL_FILTER_VALUE || posting.department === team) &&
      (location === ALL_FILTER_VALUE || posting.location === location)
  )
}

/** Whether either the Team or Location filter is narrowing the board. */
export function hasActiveFilters(team: string, location: string): boolean {
  return team !== ALL_FILTER_VALUE || location !== ALL_FILTER_VALUE
}

/**
 * Buckets postings by department, preserving their incoming order (the fetcher
 * pre-sorts by department then title). Shared by the interactive board and its
 * static Suspense fallback so the two can never render a different grouping.
 */
export function groupByDepartment(postings: CareerPosting[]): DepartmentGroup[] {
  const byDepartment = new Map<string, CareerPosting[]>()
  for (const posting of postings) {
    const bucket = byDepartment.get(posting.department)
    if (bucket) bucket.push(posting)
    else byDepartment.set(posting.department, [posting])
  }
  return Array.from(byDepartment, ([department, items]) => ({ department, postings: items }))
}
