import { Button, ChipTag } from '@sim/emcn'
import { Undo } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'

/**
 * Rollback told as a "return to known-good" gesture inside the lifecycle
 * tile's outlined window chrome: the window is a 1px `--border-1` hairline
 * outline with no fill (tile grey showing through), anchored to the text
 * column's left edge (`left-0`, `top-5`) and bleeding off the right and
 * bottom edges with a `rounded-tl-xl` top-left corner — the same slot
 * geometry as the build and lifecycle windows. A "Version history" title
 * bar with a right-aligned `Production` mono ChipTag (its fill stepped up
 * to `--surface-6` so the pill stays legible on the grey ground) crowns
 * the window at the family's `h-12` header height, ruled by a hairline
 * divider.
 *
 * Inside, a short newest-first version rail runs down the left gutter —
 * v4 as the quiet current row (its `Current` tag on the grey-ground
 * `--surface-6` pill fill), then a plain vertical hairline connector
 * down to v3, the lifecycle timeline's spine language. v3 is the tile's
 * highlight: the node fills solid and
 * the row lifts onto a white card (`--white` fill, 1px `--border-1`
 * hairline, nested `rounded-lg` inside the `rounded-tl-xl` window,
 * `shadow-sm`) pairing "v3 · Stable · Maya Chen" with the tile's
 * strongest element, the solid Roll back button led by a small `Undo`
 * glyph inked in the button's inverse text color. A quieter v2 row
 * dissolves through a mask gradient below, implying the history continues
 * past the window's bled bottom edge — the lifecycle tile's fade device.
 *
 * The window bleeds `2rem` past the tile's visible right edge (`1.5rem`
 * under `max-lg`), so the header and body carry matching extra right
 * padding (`pr-12 max-lg:pr-10` = the bleed plus the usual `1rem` gutter)
 * to keep the Production tag and the v3 card's Roll back button fully
 * inside the visible tile.
 *
 * The rail is fully static. The connector hairlines are absolutely
 * positioned inside fixed-height spacer rows so they can extend past the
 * row box into the adjacent rows' empty gutter space, ending a couple of
 * pixels from each node — the lifecycle spine's tight node-to-line
 * clearance — without disturbing the flow layout.
 */
export function RollbackGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute top-5 right-0 bottom-0 left-0 rounded-tl-xl border-[var(--border-1)] border-t border-l'
      >
        <div className='flex h-12 items-center justify-between gap-2 border-[var(--border-1)] border-b px-4 pr-12 max-lg:pr-10'>
          <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-base'>
            Version history
          </span>
          <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
            Production
          </ChipTag>
        </div>

        <div className='p-4 pr-12 [mask-image:linear-gradient(to_bottom,black_55%,transparent_98%)] max-lg:pr-10'>
          <div className='flex items-center gap-3'>
            <span className='flex w-2.5 shrink-0 justify-center'>
              <span className='size-2 rounded-full border border-[var(--text-muted)] bg-[var(--surface-3)]' />
            </span>
            <span className='flex min-w-0 flex-1 items-center gap-2'>
              <span className='font-medium text-[var(--text-secondary)] text-small'>v4</span>
              <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
                Current
              </ChipTag>
            </span>
            <span className='shrink-0 text-[var(--text-muted)] text-caption'>Published 2h ago</span>
          </div>

          <div className='flex'>
            <span className='relative flex h-[38px] w-2.5 shrink-0 justify-center'>
              <span className='-top-[4px] -bottom-[24px] absolute w-px bg-[color:color-mix(in_srgb,var(--text-muted)_35%,transparent)]' />
            </span>
          </div>

          <div className='flex items-center gap-3'>
            <span className='flex w-2.5 shrink-0 justify-center'>
              <span className='size-2.5 rounded-full bg-[var(--text-primary)]' />
            </span>
            <div className='flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm'>
              <span className='min-w-0 flex-1'>
                <span className='flex items-center gap-2'>
                  <span className='font-medium text-[var(--text-primary)] text-small'>v3</span>
                  <ChipTag variant='mono'>Stable</ChipTag>
                </span>
                <span className='mt-0.5 block truncate text-[var(--text-muted)] text-caption'>
                  Maya Chen · Jun 30
                </span>
              </span>
              <Button
                variant='primary'
                size='sm'
                tabIndex={-1}
                className='pointer-events-none shrink-0 gap-1'
              >
                <Undo className='size-[12px]' />
                Roll back
              </Button>
            </div>
          </div>

          <div className='flex'>
            <span className='relative flex h-[28px] w-2.5 shrink-0 justify-center'>
              <span className='-top-[24px] -bottom-[4px] absolute w-px bg-[color:color-mix(in_srgb,var(--text-muted)_35%,transparent)]' />
            </span>
          </div>

          <div className='flex items-center gap-3'>
            <span className='flex w-2.5 shrink-0 justify-center'>
              <span className='size-2 rounded-full border border-[color:color-mix(in_srgb,var(--text-muted)_60%,transparent)] bg-[var(--surface-3)]' />
            </span>
            <span className='flex min-w-0 flex-1 items-center gap-2'>
              <span className='text-[var(--text-muted)] text-small'>v2</span>
              <span className='truncate text-[var(--text-muted)] text-caption'>Saved Jun 24</span>
            </span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
