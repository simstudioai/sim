'use client'

import { ChipSelect, type ChipSelectOption } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import type { CareerPosting } from '@/lib/ashby/jobs'
import {
  groupByDepartment,
  JobGroups,
} from '@/app/(landing)/careers/components/job-board/job-groups'
import {
  ALL_FILTER_VALUE,
  careersParsers,
  careersUrlKeys,
} from '@/app/(landing)/careers/search-params'

interface JobBoardProps {
  postings: CareerPosting[]
}

/** Builds `{ label, value }` options for a filter, with an "All" row at the top. */
function toFilterOptions(values: string[], allLabel: string): ChipSelectOption[] {
  return [
    { label: allLabel, value: ALL_FILTER_VALUE },
    ...values.map((value) => ({ label: value, value })),
  ]
}

/** Distinct, alphabetically sorted values from a list. */
function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

/**
 * The interactive open-roles board — the single `'use client'` leaf on the
 * careers page. Every posting is server-rendered into the HTML (via the static
 * {@link JobGroups} Suspense fallback in `careers.tsx`), so all roles stay
 * crawlable; this leaf hydrates on top to add Team/Location filtering. Filter
 * state lives in the URL via nuqs (`?team=`/`?location=`) so a filtered view is
 * shareable and survives reload/back-forward. The filter set is small and
 * static, so filtering reads the instant URL value directly (no debounce).
 */
export function JobBoard({ postings }: JobBoardProps) {
  const [{ team, location }, setFilters] = useQueryStates(careersParsers, careersUrlKeys)

  // Derived directly — the board holds a handful of postings, so recomputing on a
  // filter change is trivial and a memo would only add ceremony.
  const teamOptions = toFilterOptions(uniqueSorted(postings.map((p) => p.department)), 'All teams')
  const locationOptions = toFilterOptions(
    uniqueSorted(postings.map((p) => p.location).filter(Boolean)),
    'All locations'
  )
  const groups = groupByDepartment(
    postings.filter(
      (p) =>
        (team === ALL_FILTER_VALUE || p.department === team) &&
        (location === ALL_FILTER_VALUE || p.location === location)
    )
  )

  return (
    <div className='flex flex-col gap-10'>
      <div className='flex flex-wrap items-center gap-3'>
        <ChipSelect
          options={teamOptions}
          value={team}
          onChange={(value) => setFilters({ team: value })}
          aria-label='Filter roles by team'
        />
        <ChipSelect
          options={locationOptions}
          value={location}
          onChange={(value) => setFilters({ location: value })}
          aria-label='Filter roles by location'
        />
      </div>

      <JobGroups
        groups={groups}
        emptyMessage='No roles match these filters right now. Try clearing them, or check back soon.'
      />
    </div>
  )
}
