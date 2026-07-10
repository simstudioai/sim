import { ChipTag, cn } from '@sim/emcn'
import Image from 'next/image'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/audit-trail-graphic.module.css'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'

interface AuditEntry {
  /** Human-readable action label, matching how the audit UI renders `AuditAction` codes. */
  action: string
  /** Attributed actor shown on the detail line. */
  actor: string
  /** Resource the action touched. */
  resource: string
  /** Relative or absolute timestamp, newest first. */
  time: string
  /** Gradient team avatar attributing the entry to its actor. */
  avatar: string
}

/**
 * Ledger records newest-first, drawn from the real `AuditAction` codes in
 * `packages/audit` (`workflow.deployed`, `permission_group.updated`,
 * `credential.accessed`, `workflow.created`) rendered as spaced words the
 * way the workspace audit UI formats them, and threading the running
 * Support-agent story: Maya ships v3, the Support permission group is
 * tuned, a Zendesk credential access is recorded, and the trail reaches
 * back to the workflow's creation.
 */
const ENTRIES: readonly AuditEntry[] = [
  {
    action: 'Workflow deployed',
    actor: 'Maya Chen',
    resource: 'Support agent v3',
    time: 'Now',
    avatar: '/landing/team-avatar-1.jpg',
  },
  {
    action: 'Permission group updated',
    actor: 'Jordan Lee',
    resource: 'Support team',
    time: '2 min ago',
    avatar: '/landing/team-avatar-2.jpg',
  },
  {
    action: 'Credential accessed',
    actor: 'Sam Ortiz',
    resource: 'Zendesk OAuth',
    time: '26 min ago',
    avatar: '/landing/team-avatar-3.jpg',
  },
  {
    action: 'Workflow created',
    actor: 'Maya Chen',
    resource: 'Support agent',
    time: 'Jun 14',
    avatar: '/landing/team-avatar-1.jpg',
  },
] as const

/** Per-row ink treatments, quieter with age like the lifecycle timeline. */
const ROW_TONES = [
  { action: 'text-[var(--text-primary)]', avatar: 'opacity-100' },
  { action: 'text-[var(--text-secondary)]', avatar: 'opacity-80' },
  { action: 'text-[var(--text-muted)]', avatar: 'opacity-60' },
  { action: 'text-[var(--text-muted)]', avatar: 'opacity-40' },
] as const

/**
 * Sim's audit trail told as an append-only ledger rather than a product
 * window: a frameless, centered vignette (the access tile's composition,
 * which sits beside it in the row) where each record is a plain row —
 * gradient actor avatar, the action label in the row's regular sans face
 * (`font-medium text-small`, the same treatment the standards tile gives
 * its row titles), an "actor · resource" attribution line, and a
 * right-aligned timestamp. The newest record is the selected event: it
 * sits on a solid white card wearing the build tile's window chrome
 * exactly — `--white` fill, 1px `--border-1` hairline, `rounded-xl`,
 * `shadow-sm` — while the older records rest directly on the tile,
 * quietening with age until a mask gradient dissolves the oldest —
 * implying the trail continues into history. A small "Audit log"
 * header with an `Append-only` mono ChipTag (fill stepped up to
 * `--surface-6` so the pill stays legible on the grey ground) names the
 * surface without window chrome.
 *
 * Motion (from `audit-trail-graphic.module.css`): the newest record stamps
 * in once from above — an append, never re-played, since the record is
 * immutable — and its avatar then carries the row's shared 6s ring-pulse
 * beat (matching the access tile's grant node and the lifecycle tile's
 * live node). Both are removed under `prefers-reduced-motion`.
 *
 * The avatar assets are grey radial gradients on a black square, so each
 * sits in a `rounded-full overflow-hidden` clip with a slight scale-up to
 * crop the black canvas past the circle's edge.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled slot's
 * center.
 */
export function AuditTrailGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px]'>
          <div className='mb-4 flex items-center justify-between'>
            <span className='font-medium text-[var(--text-primary)] text-base'>Audit log</span>
            <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
              Append-only
            </ChipTag>
          </div>

          <div className='flex flex-col gap-1.5 [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]'>
            {ENTRIES.map((entry, index) => {
              const tone = ROW_TONES[index]
              const newest = index === 0

              return (
                <div
                  key={entry.action}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5',
                    newest &&
                      cn(
                        'rounded-xl border border-[var(--border-1)] bg-[var(--white)] shadow-sm',
                        styles.stampIn
                      )
                  )}
                >
                  <span
                    className={cn(
                      'relative size-7 shrink-0 overflow-hidden rounded-full shadow-sm',
                      tone.avatar,
                      newest && styles.sealPulse
                    )}
                  >
                    <Image
                      src={entry.avatar}
                      alt=''
                      width={28}
                      height={28}
                      className='size-full scale-110 object-cover'
                    />
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className={cn('block truncate font-medium text-small', tone.action)}>
                      {entry.action}
                    </span>
                    <span className='block truncate text-[var(--text-muted)] text-caption'>
                      {entry.actor} · {entry.resource}
                    </span>
                  </span>
                  <span className='shrink-0 self-start pt-px text-[var(--text-muted)] text-caption'>
                    {entry.time}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
