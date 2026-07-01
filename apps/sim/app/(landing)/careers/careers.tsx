import { Suspense } from 'react'
import type { SearchParams } from 'nuqs/server'
import { getAshbyJobs } from '@/lib/ashby/jobs'
import {
  filterPostings,
  groupByDepartment,
  hasActiveFilters,
  JobBoard,
  JobGroups,
} from '@/app/(landing)/careers/components/job-board'
import { careersSearchParamsCache } from '@/app/(landing)/careers/search-params'
import { TrustedBy } from '@/app/(landing)/components/trusted-by'

interface CareersProps {
  searchParams: Promise<SearchParams>
}

/**
 * The careers page — a mission-led hero above the live open-roles board. Roles
 * are pulled from Sim's public Ashby job board at build/revalidate time
 * ({@link getAshbyJobs}) and server-rendered in full, so every posting is in the
 * crawlable HTML; the interactive {@link JobBoard} hydrates on top to add
 * Team/Location filtering.
 *
 * Both sections share the landing gutter — capped and centered at `max-w-[1446px]`
 * with the navbar-aligned `px-12 max-lg:px-8 max-sm:px-5` so the headline starts on
 * the same vertical line as the wordmark. The hero carries the single `<h1>`
 * (containing "Sim" and "AI workspace") plus an sr-only product summary for AI
 * citation (landing CLAUDE.md → GEO); the roles section owns its own `<h2>`.
 *
 * Because {@link JobBoard} reads the URL via nuqs (`useSearchParams`), it sits under
 * a `<Suspense>` boundary. The page parses the same `?team=`/`?location=` query on
 * the server ({@link careersSearchParamsCache}) and pre-filters the fallback to
 * match, so a deep-linked filter renders the correct roles server-side — the list
 * never flashes unfiltered before the client board hydrates.
 */
export default async function Careers({ searchParams }: CareersProps) {
  const { team, location } = await careersSearchParamsCache.parse(searchParams)
  const postings = await getAshbyJobs()
  const fallbackGroups = groupByDepartment(filterPostings(postings, team, location))

  return (
    <main id='main-content'>
      <section
        id='careers-hero'
        aria-labelledby='careers-heading'
        className='mx-auto flex w-full max-w-[1446px] flex-col gap-5 px-12 pt-20 pb-10 max-sm:px-5 max-sm:pt-16 max-lg:px-8'
      >
        <p className='sr-only'>
          Careers at Sim, the open-source AI workspace where teams build, deploy, and manage AI
          agents. Sim is hiring engineers, designers, and go-to-market builders to help teams
          automate real work across 1,000+ integrations and every major LLM — visually,
          conversationally, or with code.
        </p>

        <h1
          id='careers-heading'
          className='max-w-[24ch] text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-[40px]'
        >
          Help build Sim, the AI workspace for teams.
        </h1>
        <p className='max-w-[60ch] text-pretty text-[var(--text-body)] text-lg leading-[1.5] max-sm:text-base'>
          Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. We're
          a small, high-agency team shipping fast to thousands of builders. If you want to own real
          work and shape the workspace teams live in, we'd love to meet you.
        </p>
      </section>

      <section
        id='open-roles'
        aria-labelledby='open-roles-heading'
        className='mx-auto flex w-full max-w-[1446px] flex-col gap-10 px-12 pt-6 pb-24 max-sm:px-5 max-sm:pb-16 max-lg:px-8'
      >
        <h2
          id='open-roles-heading'
          className='text-[24px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'
        >
          Open roles
        </h2>

        <Suspense
          fallback={
            <JobGroups groups={fallbackGroups} filtersActive={hasActiveFilters(team, location)} />
          }
        >
          <JobBoard postings={postings} />
        </Suspense>

        <TrustedBy className='pt-6' />
      </section>
    </main>
  )
}
