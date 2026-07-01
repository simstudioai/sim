import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import type { CareerPosting } from '@/lib/ashby/jobs'
import type { DepartmentGroup } from '@/app/(landing)/careers/components/job-board/utils'

/** Empty-state copy: distinguishes a truly empty board from a filtered-to-zero view. */
const NO_OPEN_ROLES_MESSAGE = 'No open roles right now — check back soon.'
const NO_MATCHING_ROLES_MESSAGE =
  'No roles match these filters right now. Try clearing them, or check back soon.'

interface JobGroupsProps {
  groups: DepartmentGroup[]
  /**
   * Whether a Team/Location filter is active. Selects the empty-state copy so an
   * unfiltered empty board ("no open roles") never reads as a filtered miss ("no
   * matches") — and the server fallback and client board always agree.
   */
  filtersActive?: boolean
}

/**
 * The presentational open-roles list: one labeled section per department, each a
 * list of {@link JobRow}s. Server-safe (no client hooks) so it renders both as
 * the static Suspense fallback and inside the client {@link JobBoard}.
 */
export function JobGroups({ groups, filtersActive = false }: JobGroupsProps) {
  if (groups.length === 0) {
    return (
      <p className='py-10 text-[var(--text-muted)] text-base'>
        {filtersActive ? NO_MATCHING_ROLES_MESSAGE : NO_OPEN_ROLES_MESSAGE}
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-12'>
      {groups.map((group) => (
        <section
          key={group.department}
          aria-label={`${group.department} roles`}
          className='flex flex-col'
        >
          <h3 className='pb-2 font-medium text-[var(--text-muted)] text-sm'>{group.department}</h3>
          <ul className='flex flex-col'>
            {group.postings.map((posting) => (
              <li key={posting.id}>
                <JobRow posting={posting} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

interface JobRowProps {
  posting: CareerPosting
}

/**
 * A single role row: title over a metadata line, with an "Apply" affordance that
 * links out to the posting on Ashby. The whole row is the link target; hovering
 * tints the row and advances the arrow. The metadata values are de-duplicated
 * because a remote posting normalizes both `location` and `workplaceType` to
 * "Remote", which would otherwise render "Remote · Remote" and collide as keys.
 */
function JobRow({ posting }: JobRowProps) {
  const meta = Array.from(
    new Set(
      [
        posting.location,
        posting.employmentType,
        posting.workplaceType,
        posting.compensationSummary,
      ].filter((value): value is string => Boolean(value))
    )
  )

  return (
    <a
      href={posting.jobUrl}
      target='_blank'
      rel='noopener noreferrer'
      className={cn(
        'group flex items-center justify-between gap-6 border-[var(--border)] border-t py-5',
        'transition-colors hover:bg-[var(--surface-hover)]'
      )}
    >
      <div className='flex min-w-0 flex-col gap-1.5'>
        <h4 className='truncate font-medium text-[var(--text-primary)] text-base'>
          {posting.title}
        </h4>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-muted)] text-sm'>
          {meta.map((item, index) => (
            <span key={item} className='flex items-center gap-2'>
              {index > 0 && (
                <span aria-hidden className='text-[var(--text-muted)]'>
                  ·
                </span>
              )}
              {item}
            </span>
          ))}
        </div>
      </div>

      <span className='flex shrink-0 items-center gap-1.5 font-medium text-[var(--text-body)] text-sm'>
        Apply
        <ArrowRight className='size-[14px] text-[var(--text-icon)] transition-transform group-hover:translate-x-0.5' />
      </span>
    </a>
  )
}
