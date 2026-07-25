import { ChipTag, cn } from '@sim/emcn'
import { CircleCheck } from '@sim/emcn/icons'
import Image from 'next/image'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/it-platform-teams-graphic.module.css'

export interface PolicyControl {
  /** Enforced control name, one per pillar of the tile's claim. */
  label: string
  /** Right-aligned enforcement detail. */
  detail: string
}

/**
 * The three enforced controls mirror the tile's claim word for word —
 * access controls (SSO), governance (reviewer approval), and audit
 * trails (retention).
 */
const CONTROLS: readonly [PolicyControl, PolicyControl, PolicyControl] = [
  { label: 'Single sign-on', detail: 'Enforced' },
  { label: 'Reviewer approval', detail: 'Required' },
  { label: 'Audit history', detail: '90 days' },
] as const

/**
 * IT governance told as a frameless policy vignette (the audit and
 * monitoring tiles' composition): no window chrome — a small "Workspace
 * policies" header sits directly on the tile ground, attributed on the
 * right to the managing team: a 16px gradient avatar (the access and
 * audit tiles' team-avatar treatment) beside a `Managed by IT` mono
 * ChipTag, its fill stepped up to `--surface-6` so the pill stays
 * legible on the grey ground (the staging and rollback tiles'
 * environment-pill treatment). Below it, the tile's highlight: the active Production
 * policy lifted onto a white card in the audit tile's exact chrome
 * (`--white` fill, 1px `--border-1` hairline, `rounded-xl`, `shadow-sm`)
 * pairing the policy name and its scope line with an `Active` tag that
 * carries the tile's one motion, the family's shared quiet 6s ring pulse
 * (from `it-platform-teams-graphic.module.css`, removed under
 * `prefers-reduced-motion`). Under the card, the policy's enforced
 * controls read as quiet hairline-ruled rows — a passing circle-check,
 * the control name, and a right-aligned enforcement detail — one row per
 * pillar of the tile's claim: access controls, governance, audit trails.
 *
 * The avatar asset is a grey radial gradient on a black square, so it
 * sits in a `rounded-full overflow-hidden` clip with a slight scale-up
 * to crop the black canvas past the circle's edge.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled
 * slot's center. The column is fluid (`w-full max-w-[312px]`) so it
 * never exceeds the compensated slot at narrow tile widths — the policy
 * name truncates instead of clipping.
 *
 * Every label is parametrizable so other landing pages (IT, HR,
 * compliance) can retell the checklist-under-a-highlight composition for
 * their own domain — an incident runbook, an onboarding plan, an
 * evidence schedule; the defaults keep the enterprise page's workspace
 * policy vignette byte-identical. Chrome, motion, and layout never
 * change with the copy.
 */
interface ItPlatformTeamsGraphicProps {
  /** Header title. */
  title?: string
  /** Mono badge on the header's right side, beside the avatar. */
  badgeLabel?: string
  /** Title line of the highlighted white card. */
  cardTitle?: string
  /** Scope line beneath the card title. */
  cardSubtitle?: string
  /** Grey tag carrying the card's pulsing state. */
  cardTag?: string
  /** The three checked rows beneath the card. */
  controls?: readonly [PolicyControl, PolicyControl, PolicyControl]
}

export function ItPlatformTeamsGraphic({
  title = 'Workspace',
  badgeLabel = 'Managed by IT',
  cardTitle = 'Production policy',
  cardSubtitle = 'Applies to every workspace',
  cardTag = 'Active',
  controls = CONTROLS,
}: ItPlatformTeamsGraphicProps = {}) {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px]'>
          <div className='mb-3 flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-base'>
              {title}
            </span>
            <span className='flex shrink-0 items-center gap-1.5'>
              <span className='relative size-4 overflow-hidden rounded-full shadow-sm'>
                <Image
                  src='/landing/team-avatar-3.jpg'
                  alt=''
                  width={16}
                  height={16}
                  className='size-full scale-110 object-cover'
                />
              </span>
              <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
                {badgeLabel}
              </ChipTag>
            </span>
          </div>

          <div className='flex items-center gap-3 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm'>
            <span className='min-w-0 flex-1'>
              <span className='block truncate font-medium text-[var(--text-primary)] text-small'>
                {cardTitle}
              </span>
              <span className='block truncate text-[var(--text-muted)] text-caption'>
                {cardSubtitle}
              </span>
            </span>
            <ChipTag variant='gray' className={cn('shrink-0 shadow-none', styles.activePulse)}>
              {cardTag}
            </ChipTag>
          </div>

          <div className='mt-1.5 px-3'>
            {controls.map((control, index) => (
              <div
                key={control.label}
                className={cn(
                  'flex h-9 items-center gap-2',
                  index > 0 && 'border-[var(--border-1)] border-t'
                )}
              >
                <CircleCheck className='size-[13px] shrink-0 text-[var(--text-icon)]' />
                <span className='min-w-0 flex-1 truncate text-[var(--text-secondary)] text-caption'>
                  {control.label}
                </span>
                <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                  {control.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
