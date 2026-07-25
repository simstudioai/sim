import type { CSSProperties } from 'react'
import { ChipTag, chipContentLabelClass, chipGeometryClass, cn } from '@sim/emcn'
import { CircleCheck, Lock } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/deploy-graphic.module.css'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'

/**
 * The ThinkingLoader's light-grey material (its dark-surface theme from
 * `thinking-loader.module.css`), asserted inline because the always-light
 * landing would otherwise ink the loader dark — invisible on the dark
 * Deploy button.
 */
const DEPLOY_LOADER_INK = {
  '--tl-grad-inner': '#a7a7a7',
  '--tl-grad-outer': '#d6d6d6',
  '--tl-glow': 'rgba(255, 255, 255, 0.9)',
} as CSSProperties

/**
 * The moment of a one-click deploy, told top to bottom: the agent being
 * shipped, the Deploy button, and a
 * minimal dark browser window rising from the bottom edge with the hosted
 * endpoint's URL in its address bar — the deployed agent is literally a live
 * web address, no infrastructure in between. The window is an outlined shell
 * (grey hairline, tile shows through) whose address bar carries the Deploy
 * button's `--text-muted` fill, so click and outcome read as one system. A
 * single causal vignette instead of a workflow canvas, so the click itself is
 * the subject. Faint `--text-muted-inverse` hairlines (mixed toward the dark
 * tile background so they read as guides) link agent → button → browser, and
 * a white progress sweep (from `deploy-graphic.module.css`) loops down the
 * two hairlines in sequence on a shared 4.5s timeline — pill → button, then
 * button → browser. The instant the sweep's leading edge lands on the
 * browser's top edge, the outline trace takes over with no gap: the white
 * line splits at the top-center connection point and draws outward both
 * ways along the top border, bends around the rounded corners, and
 * continues down the sides while its tail releases from center and follows
 * the head — a traveling pulse that runs out and off the outline rather
 * than painting it permanently. It is implemented as four rounded-rect
 * border overlay copies (top pair + side pair, mirrored) revealed by
 * animated `clip-path` inset windows, so the trace follows the exact
 * rounded-corner geometry at any width. Under `prefers-reduced-motion`
 * everything is static — plain faint lines, no sweep or trace.
 *
 * The Deploy button's icon is the gooey {@link ThinkingLoader} pinned to
 * `relay` — the Return shape (work coming back) — looping its ball pass,
 * inked light so it reads on the dark button.
 *
 * The agent header follows the nested-corner radius rule: the `v3` ChipTag is
 * `rounded-md` (6px) and sits 6px (`py-1.5` / `pr-1.5`) from the container
 * edge, so the container radius is 6px + 6px = 12px.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under `max-lg`)
 * but not left, so this centered vignette adds matching right padding to land
 * on the tile's visible center instead of the bled slot's center.
 *
 * The browser window is pinned to `h-24` (96px) so its top edge lands on the
 * same line as the neighboring build-methods tile's composer (76px tall +
 * `bottom-5`), keeping the tile row horizontally aligned; both connector
 * lines are `flex-1` with mirrored margins, so the Deploy button stays
 * equidistant between the agent pill and the browser at any tile height.
 *
 * Every label is parametrizable so other landing pages (engineering,
 * IT, finance, workflows) can retell the click-to-live moment with their
 * own agent and outcome; the defaults keep the enterprise page's
 * Support-agent deploy byte-identical. Geometry, motion, and inks never
 * change with the copy.
 */
interface DeployGraphicProps {
  /** Agent pill label. */
  agentName?: string
  /** Version tag beside the agent name. */
  versionTag?: string
  /** Action button label. */
  buttonLabel?: string
  /** Address-bar URL of the deployed agent. */
  url?: string
  /** Status line inside the dark browser window. */
  statusLabel?: string
  /** Right-aligned status timestamp. */
  timeLabel?: string
}

export function DeployGraphic({
  agentName = 'Support agent',
  versionTag = 'v3',
  buttonLabel = 'Deploy',
  url = 'sim.ai/agents/support',
  statusLabel = 'Live in production',
  timeLabel = 'Just now',
}: DeployGraphicProps = {}) {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex flex-col items-center pr-8 max-lg:pr-6'
      >
        <div className='mt-1 flex items-center gap-1.5 rounded-[12px] bg-[var(--surface-2)] py-1.5 pr-1.5 pl-2.5 shadow-sm'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>{agentName}</span>
          <ChipTag variant='mono'>{versionTag}</ChipTag>
        </div>

        <span className='relative mt-1.5 min-h-3 w-px flex-1 overflow-hidden bg-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'>
          <span className={styles.sweep} />
        </span>

        <span
          className={cn(
            chipGeometryClass,
            'mx-0 mt-2.5 inline-flex h-9 rounded-[10px] bg-[var(--text-muted)] px-3 text-[var(--text-inverse)]'
          )}
        >
          <ThinkingLoader variant='relay' size={18} style={DEPLOY_LOADER_INK} />
          <span className={cn(chipContentLabelClass, 'text-[15px] text-current')}>
            {buttonLabel}
          </span>
        </span>

        <span className='relative mt-2.5 mb-1.5 min-h-3 w-px flex-1 overflow-hidden bg-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'>
          <span className={cn(styles.sweep, styles.sweepLower)} />
        </span>

        <div className='relative h-24 w-full rounded-t-xl border border-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)] border-b-0'>
          <span
            className={cn(
              '-inset-px absolute rounded-t-xl border border-[var(--text-inverse)] border-b-0',
              styles.traceTopLeft
            )}
          />
          <span
            className={cn(
              '-inset-px absolute rounded-t-xl border border-[var(--text-inverse)] border-b-0',
              styles.traceTopRight
            )}
          />
          <span
            className={cn(
              '-inset-px absolute rounded-t-xl border border-[var(--text-inverse)] border-b-0',
              styles.traceSideLeft
            )}
          />
          <span
            className={cn(
              '-inset-px absolute rounded-t-xl border border-[var(--text-inverse)] border-b-0',
              styles.traceSideRight
            )}
          />
          <div className='flex items-center gap-2 px-2.5 pt-2.5 pb-1'>
            <span className='flex shrink-0 gap-1'>
              <span className='size-2 rounded-full bg-[var(--text-muted-inverse)]' />
              <span className='size-2 rounded-full bg-[var(--text-muted-inverse)]' />
              <span className='size-2 rounded-full bg-[var(--text-muted-inverse)]' />
            </span>
            <span className='flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--text-muted)] px-2 py-1'>
              <Lock className='size-[10px] shrink-0 text-[var(--text-muted-inverse)]' />
              <span className='truncate text-[var(--text-inverse)] text-caption'>{url}</span>
            </span>
          </div>
          <div className='flex items-center gap-2 px-3 pt-2.5 pb-4'>
            <CircleCheck className='size-[14px] shrink-0 text-[var(--text-muted-inverse)]' />
            <span className='min-w-0 flex-1 font-medium text-[var(--text-inverse)] text-small'>
              {statusLabel}
            </span>
            <span className='shrink-0 text-[var(--text-muted-inverse)] text-caption'>
              {timeLabel}
            </span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
