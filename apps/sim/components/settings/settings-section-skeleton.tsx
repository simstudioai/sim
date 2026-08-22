import { Skeleton } from '@sim/emcn'

/**
 * Row count is deliberately generic. Sections differ too much for a faithful per-section
 * skeleton, and the header above this — title, description, docs link — is already real,
 * resolved from the routed section's navigation entry before the body exists.
 */
const PLACEHOLDER_ROWS = [0, 1, 2, 3]

/**
 * The one body placeholder for a settings section that is not on screen yet.
 *
 * Rendered by a route's `loading.tsx` while its access gate resolves, and again by
 * {@link SETTINGS_SECTION_LOADING_OPTIONS} while the section's chunk is in flight. Sharing a single
 * component across both is what makes those two waits read as one continuous state rather
 * than skeleton → blank → content.
 */
export function SettingsSectionSkeleton() {
  return (
    <div className='flex flex-col gap-3' aria-hidden>
      {PLACEHOLDER_ROWS.map((row) => (
        <Skeleton key={row} className='h-[36px] w-full' />
      ))}
    </div>
  )
}
