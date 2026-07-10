import { ChipTag, cn } from '@sim/emcn'
import { Clock } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/lifecycle-graphic.module.css'

/** Older timeline entries below the live/saved pair, quietest first to render. */
const OLDER_VERSIONS = [
  { detail: 'Published Jun 28', label: 'v1' },
  { detail: 'Saved Jun 21', label: 'v0.9' },
  { detail: 'Saved Jun 14', label: 'v0.8' },
] as const

/**
 * A version-history timeline housed in an outlined window shell that mirrors
 * the build tile's editor window exactly — same slot geometry (`top-5`,
 * `left-0` so the window left-aligns with the tile's text column, bled
 * right/bottom), same `rounded-tl-xl` radius, same top + left
 * hairline `--border-1` edges — but drawn with no fill so the tile shows
 * through: the two side-by-side tiles read as the same window in the same
 * place, one filled, one outlined. An outlined title bar ("Versions" with a
 * `Clock` icon in the build header's `size-6` `rounded-md` icon box — drawn
 * as a `--border-1` hairline outline instead of the filled grey — no fill,
 * `--border-1` bottom rule at the build header's `h-12` height) crowns the
 * window. Inside, a quiet vertical spine of faint
 * static 1px connector segments (the light analog of the deploy tile's guide
 * lines) links version nodes bottom-up — older versions lower and
 * progressively quieter, v3 at the top as the live entry. The live row is a
 * white pill card following the nested-corner radius rule (6px ChipTag + 6px
 * gap = 12px container), echoing the deploy tile's agent header; older rows
 * are bare text rows that fade toward `--text-muted` (the v2 `Saved`
 * tag's fill stepped up to `--surface-6` so the pill stays legible on
 * the grey ground), and a mask gradient
 * dissolves the oldest entries so the timeline reads as continuing into
 * history past the window's bottom edge.
 *
 * The only motion is a soft ring pulse on the live node (from
 * `lifecycle-graphic.module.css`), removed under `prefers-reduced-motion`.
 */
export function LifecycleGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute top-5 right-0 bottom-0 left-0 rounded-tl-xl border-[var(--border-1)] border-t border-l'
      >
        <div className='flex h-12 items-center gap-2 border-[var(--border-1)] border-b px-4'>
          <span className='flex size-6 items-center justify-center rounded-md border border-[var(--border-1)]'>
            <Clock className='size-[14px] text-[var(--text-icon)]' />
          </span>
          <span className='font-medium text-[var(--text-primary)] text-base'>Versions</span>
        </div>
        <div className='flex flex-col p-4 [mask-image:linear-gradient(to_bottom,black_45%,transparent_98%)]'>
          <div className='flex items-center gap-3'>
            <span className='flex w-2.5 justify-center'>
              <span
                className={cn('size-2.5 rounded-full bg-[var(--text-primary)]', styles.livePulse)}
              />
            </span>
            <span className='flex min-w-0 flex-1 items-center gap-2'>
              <span className='flex items-center gap-1.5 rounded-[12px] bg-[var(--white)] py-1.5 pr-1.5 pl-2.5 shadow-sm'>
                <span className='font-medium text-[var(--text-primary)] text-small'>v3</span>
                <ChipTag variant='solid'>Live</ChipTag>
              </span>
              <span className='truncate text-[var(--text-muted)] text-caption'>
                Published today
              </span>
            </span>
          </div>

          <div className='flex gap-3'>
            <span className='flex w-2.5 justify-center'>
              <span className='h-9 w-px bg-[color:color-mix(in_srgb,var(--text-muted)_35%,transparent)]' />
            </span>
          </div>

          <div className='flex items-center gap-3'>
            <span className='flex w-2.5 justify-center'>
              <span className='size-2 rounded-full border border-[var(--text-muted)] bg-[var(--surface-3)]' />
            </span>
            <span className='flex min-w-0 flex-1 items-center gap-2'>
              <span className='font-medium text-[var(--text-secondary)] text-small'>v2</span>
              <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
                Saved
              </ChipTag>
              <span className='truncate text-[var(--text-muted)] text-caption'>
                Published yesterday
              </span>
            </span>
          </div>

          {OLDER_VERSIONS.map((version) => (
            <div key={version.label} className='flex flex-col'>
              <div className='flex gap-3'>
                <span className='flex w-2.5 justify-center'>
                  <span className='h-9 w-px bg-[color:color-mix(in_srgb,var(--text-muted)_35%,transparent)]' />
                </span>
              </div>
              <div className='flex items-center gap-3'>
                <span className='flex w-2.5 justify-center'>
                  <span className='size-2 rounded-full border border-[color:color-mix(in_srgb,var(--text-muted)_60%,transparent)] bg-[var(--surface-3)]' />
                </span>
                <span className='flex min-w-0 flex-1 items-center gap-2'>
                  <span className='text-[var(--text-muted)] text-small'>{version.label}</span>
                  <span className='truncate text-[var(--text-muted)] text-caption'>
                    {version.detail}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
