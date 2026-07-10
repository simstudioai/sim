import { ChipTag, cn } from '@sim/emcn'
import { ShieldCheck } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/standards-graphic.module.css'

/**
 * Enterprise standards told as a certification seal, with no window
 * framing: a shield-check medallion at the center wearing the deploy
 * tile's Deploy-button chrome — the same `--text-muted` fill with
 * `--text-inverse` ink — so the two dark tiles' hero elements read as
 * siblings. It is ringed by two concentric hairlines like a certificate
 * mark, with the outer ring dissolving through a mask the way the row's
 * older elements fade. The tile's two claims anchor the seal from either
 * side over short hairline connectors with port dots (the access tile's
 * junction vocabulary): a `SOC 2` chip and an `Open source` chip, whose
 * mono `--surface-5` fills read as light pills on the dark ground
 * exactly like the deploy tile's ChipTag. Each chip is anchored by its
 * connector-facing edge to the connector's endpoint (not centered on a
 * fixed x), so both junctions stay flush regardless of label width. A `Verified` pill beneath the seal carries the emphasized
 * state on the deploy tile's `--text-muted` chip fill with `--text-inverse`
 * ink (ChipTag's solid variant would vanish here — its fill is the tile's
 * own `--text-secondary`). The seal blooms the row's shared 6s ring pulse
 * (from `standards-graphic.module.css`, removed under
 * `prefers-reduced-motion`).
 *
 * Inks follow the deploy tile's dark-surface palette: hairlines and dots
 * mix `--text-muted-inverse` toward transparent (45% on the working
 * lines, fainter on the decorative rings), and the port dots fill with
 * the tile's `--text-secondary` so the connector reads as passing
 * beneath them.
 *
 * The two connectors are SVG paths normalized to `pathLength=1` so they
 * draw in with the page's dash vocabulary (the deploy tile's stagger):
 * SOC 2 draws into the seal first, the seal draws out to Open source a
 * beat later, both hold, then un-draw forward and loop on the shared 6s
 * timeline. Under `prefers-reduced-motion` they render fully drawn with
 * no animation.
 *
 * Each ring also carries a comet arc — the deploy tile's white connector
 * sweep made circular: a fixed 50° arc over the hairline, stroked with a
 * `userSpaceOnUse` linear gradient that is bright at the clockwise
 * leading tip and fades to transparent along the trailing side, inside a
 * group that rotates around the seal center (a rotating group rather
 * than a dash offset, because a dash wrapping the circle's path start
 * renders a stray seam-cap artifact). The two orbits share one 14s
 * period but the outer runs phase-shifted half a revolution, so the
 * sweeps are never synchronized; the outer sweep sits inside the same
 * fade mask as its hairline so it dissolves through the bottom of the
 * tile like the ring it traces. Under `prefers-reduced-motion` the
 * sweeps are hidden entirely.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so the canvas sits inside a matching
 * right-padded box to land on the tile's visible center instead of the
 * bled slot's center. The canvas itself is centered with a transform
 * (`left-1/2` + `-translate-x-1/2`) rather than flex `justify-center`
 * because an overflowing fixed-size flex item start-aligns instead of
 * centering once the tile gets narrower than the canvas.
 */
export function StandardsGraphic() {
  return (
    <FeatureGraphicShell>
      <div aria-hidden='true' className='absolute inset-0 pr-8 max-lg:pr-6'>
        <div className='relative h-full'>
          <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-[250px] w-[320px]'>
            <div className='absolute top-0 left-[48px] size-[224px] rounded-full border border-[color:color-mix(in_srgb,var(--text-muted-inverse)_22%,transparent)] [mask-image:linear-gradient(to_bottom,black_30%,transparent_92%)]' />
            <div className='absolute top-[36px] left-[84px] size-[152px] rounded-full border border-[color:color-mix(in_srgb,var(--text-muted-inverse)_35%,transparent)]' />

            <svg
              className='absolute inset-0'
              fill='none'
              viewBox='0 0 320 250'
              width={320}
              height={250}
            >
              <defs>
                <linearGradient
                  id='standards-sweep-inner'
                  gradientUnits='userSpaceOnUse'
                  x1='235.5'
                  y1='112'
                  x2='208.53'
                  y2='169.84'
                >
                  <stop offset='0' stopColor='var(--text-inverse)' stopOpacity='0' />
                  <stop offset='1' stopColor='var(--text-inverse)' stopOpacity='0.9' />
                </linearGradient>
                <linearGradient
                  id='standards-sweep-outer'
                  gradientUnits='userSpaceOnUse'
                  x1='271.5'
                  y1='112'
                  x2='231.67'
                  y2='197.41'
                >
                  <stop offset='0' stopColor='var(--text-inverse)' stopOpacity='0' />
                  <stop offset='1' stopColor='var(--text-inverse)' stopOpacity='0.9' />
                </linearGradient>
              </defs>
              <g className='[mask-image:linear-gradient(to_bottom,black_30%,transparent_92%)]'>
                <g className={cn(styles.ringSweep, styles.ringSweepOuter)}>
                  <path
                    d='M 271.5 112 A 111.5 111.5 0 0 1 231.67 197.41'
                    stroke='url(#standards-sweep-outer)'
                    strokeWidth='1'
                    strokeLinecap='round'
                  />
                </g>
              </g>
              <g className={styles.ringSweep}>
                <path
                  d='M 235.5 112 A 75.5 75.5 0 0 1 208.53 169.84'
                  stroke='url(#standards-sweep-inner)'
                  strokeWidth='1'
                  strokeLinecap='round'
                />
              </g>
              <path
                d='M 90 112.5 L 122 112.5'
                pathLength={1}
                className={styles.connector}
                stroke='color-mix(in srgb, var(--text-muted-inverse) 45%, transparent)'
                strokeWidth='1'
              />
              <path
                d='M 198 112.5 L 230 112.5'
                pathLength={1}
                className={cn(styles.connector, styles.connectorTrailing)}
                stroke='color-mix(in srgb, var(--text-muted-inverse) 45%, transparent)'
                strokeWidth='1'
              />
            </svg>

            <span className='absolute top-[108px] left-[118px] size-2 rounded-full border border-[color:color-mix(in_srgb,var(--text-muted-inverse)_70%,transparent)] bg-[var(--text-secondary)]' />
            <span className='absolute top-[108px] left-[194px] size-2 rounded-full border border-[color:color-mix(in_srgb,var(--text-muted-inverse)_70%,transparent)] bg-[var(--text-secondary)]' />

            <div
              className={cn(
                'absolute top-[74px] left-[122px] flex size-[76px] items-center justify-center rounded-full bg-[var(--text-muted)] shadow-sm',
                styles.sealPulse
              )}
            >
              <ShieldCheck className='size-7 text-[var(--text-inverse)]' />
            </div>

            <span className='-translate-x-full -translate-y-1/2 absolute top-[112px] left-[90px] whitespace-nowrap'>
              <ChipTag variant='mono'>SOC 2</ChipTag>
            </span>
            <span className='-translate-y-1/2 absolute top-[112px] left-[230px] whitespace-nowrap'>
              <ChipTag variant='mono'>Open source</ChipTag>
            </span>

            <span className='-translate-x-1/2 absolute top-[172px] left-1/2 flex h-5 items-center rounded-md bg-[var(--text-muted)] px-1.5 font-medium text-[var(--text-inverse)] text-caption'>
              Verified
            </span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
