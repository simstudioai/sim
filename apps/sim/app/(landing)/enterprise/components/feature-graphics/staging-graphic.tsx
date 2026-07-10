import { Button, ChipTag, cn } from '@sim/emcn'
import { ArrowRight, CircleCheck } from '@sim/emcn/icons'
import Image from 'next/image'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/staging-graphic.module.css'

/** Named pre-promotion checks, each rendered as a passing row. */
const CHECKS = ['Evals passed', 'No breaking changes', 'Approved by Ops'] as const

/**
 * A GitHub-style promotion surface compressed to tile scale, on the
 * lifecycle tile's outlined ground: the window is a 1px `--border-1`
 * hairline outline with no fill (tile grey showing through,
 * `rounded-xl`), topped by a plain title header ("Support agent" + a
 * `v4` mono tag on the grey-ground `--surface-6` pill fill). Below,
 * three hairline-ruled sections tell the
 * merge-area story with an inverted surface hierarchy — the build being
 * promoted is the highlight, a white card (`--white` fill, `--border-1`
 * hairline, nested `rounded-lg`, `shadow-sm`, echoing the audit tile's
 * selected-record card) pairing a short hash chip with its change
 * message and a "Maya Chen · 2h ago" attribution line (gradient avatar
 * shared with the access and audit tiles); the named check gates sit
 * directly on the grey ground as quiet passing rows; and the promotion
 * bar pairs `Staging → Live` environment tags (fills stepped up to
 * `--surface-6` so the pills stay legible on the grey ground) with the
 * tile's strongest element, the solid Promote button.
 *
 * The only motion is a soft ring pulse on the Promote button (from
 * `staging-graphic.module.css`), the family's shared quiet 6s beat,
 * removed under `prefers-reduced-motion`.
 *
 * The avatar asset is a grey radial gradient on a black square, so it
 * sits in a `rounded-full overflow-hidden` clip with a slight scale-up to
 * crop the black canvas past the circle's edge.
 *
 * The feature tile's visual slot bleeds `2rem` right and bottom
 * (`1.5rem` under `max-lg`) but not left or top, so this centered window
 * adds matching right and bottom padding to land on the tile's visible
 * center instead of the bled slot's center — keeping comparable air
 * above and below the window. The section paddings stay compact
 * (`h-10` header, `py-2.5` sections) so the window's intrinsic height
 * plus the bottom-bleed compensation fits inside the slot's
 * `overflow-hidden` bounds — a taller window would push the top hairline
 * and corners past the slot's top clip line and truncate them. The
 * window is fluid (`w-full max-w-[312px]`) so it never
 * exceeds the compensated slot and both edges stay visible at narrow
 * tile widths — text rows truncate instead of clipping, and the
 * `Staging → Live` tags yield below `xl` so the promotion bar keeps the
 * Promote button inside the window.
 */
export function StagingGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 pb-8 max-lg:pr-6 max-lg:pb-6'
      >
        <div className='w-full max-w-[312px] rounded-xl border border-[var(--border-1)]'>
          <div className='flex h-10 items-center gap-2 border-[var(--border-1)] border-b px-4'>
            <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-primary)] text-base'>
              Support agent
            </span>
            <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
              v4
            </ChipTag>
          </div>

          <div className='px-3 py-2.5'>
            <div className='rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm'>
              <span className='flex items-center gap-2'>
                <ChipTag variant='mono'>a3f8c21</ChipTag>
                <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-small'>
                  Tighten refund policy checks
                </span>
              </span>
              <span className='mt-1.5 flex items-center gap-1.5'>
                <span className='relative size-4 overflow-hidden rounded-full'>
                  <Image
                    src='/landing/team-avatar-1.jpg'
                    alt=''
                    width={16}
                    height={16}
                    className='size-full scale-110 object-cover'
                  />
                </span>
                <span className='text-[var(--text-muted)] text-caption'>Maya Chen · 2h ago</span>
              </span>
            </div>
          </div>

          <div className='flex flex-col gap-2 border-[var(--border-1)] border-t px-4 py-2.5'>
            {CHECKS.map((check) => (
              <span key={check} className='flex items-center gap-2'>
                <CircleCheck className='size-[13px] text-[var(--text-icon)]' />
                <span className='text-[var(--text-secondary)] text-caption'>{check}</span>
              </span>
            ))}
          </div>

          <div className='flex items-center justify-between gap-3 border-[var(--border-1)] border-t px-4 py-2.5'>
            <span className='hidden min-w-0 items-center gap-1.5 xl:flex'>
              <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
                Staging
              </ChipTag>
              <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
              <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
                Live
              </ChipTag>
            </span>
            <Button
              variant='primary'
              size='sm'
              tabIndex={-1}
              className={cn('pointer-events-none ml-auto', styles.promotePulse)}
            >
              Promote
            </Button>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
