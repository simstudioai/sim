import { cn, Library } from '@sim/emcn'
import { LANDING_STAGE_WINDOW_RADIUS } from '@/app/(landing)/components/landing-layout'
import colorMixFallbacks from '@/app/(landing)/components/shared/color-mix-fallbacks/color-mix-fallbacks.module.css'
import {
  FeatureGraphicShell,
  type FeatureGraphicVariant,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/logs/components/feature-graphics/run-trace-graphic.module.css'

/** Window palette: the Logs page's dark feature tile, or the homepage rail's light card. */
type RunTraceGraphicTone = 'dark' | 'light'

interface RunTraceGraphicProps {
  variant?: FeatureGraphicVariant
  tone?: RunTraceGraphicTone
}

interface TraceSpanRow {
  /** Block name in the trace tree. */
  name: string
  /** Duration text, right-aligned in mono. */
  duration: string
  /** Indent class for child spans nested under the agent. */
  indentClass?: string
  /** Waterfall bar geometry - left offset and width as arbitrary classes. */
  barClass: string
  /** Bar ink - parents solid, children lighter, so depth reads at a glance. */
  barTone: 'parent' | 'child'
}

/**
 * The support-routing run's trace distilled to tile scale: the run's
 * top-level blocks with the agent's tool call and model reply nested
 * beneath it, each span's waterfall bar offset by when it started.
 */
const TRACE_SPANS: readonly TraceSpanRow[] = [
  {
    name: 'Start',
    duration: '12ms',
    barClass: 'left-0 w-[4%]',
    barTone: 'parent',
  },
  {
    name: 'Support agent',
    duration: '1.24s',
    barClass: 'left-[5%] w-[66%]',
    barTone: 'parent',
  },
  {
    name: 'Search tickets',
    duration: '420ms',
    indentClass: 'pl-3',
    barClass: 'left-[9%] w-[24%]',
    barTone: 'child',
  },
  {
    name: 'Generate reply',
    duration: '540ms',
    indentClass: 'pl-3',
    barClass: 'left-[38%] w-[30%]',
    barTone: 'child',
  },
  {
    name: 'Send to Slack',
    duration: '180ms',
    barClass: 'left-[74%] w-[11%]',
    barTone: 'parent',
  },
] as const

/** Per-row stamp-in classes - the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2, styles.row3, styles.row4] as const

/**
 * The window's palette in both tones. `dark` is the Logs page's dark
 * feature tile - inverse inks over the tile's charcoal showing through an
 * outlined shell. `light` is the homepage rail's card, wearing the same
 * chrome the sibling product graphics use (`--white` fill, 1px
 * `--border-1` hairline, `shadow-xs`) so the trace reads as the
 * workspace's own run view. Both keep the two-step parent/child ramp, so
 * nested spans stay quieter than the blocks they hang under.
 */
const TONE_STYLES = {
  dark: {
    outline: colorMixFallbacks.inverseBorder45,
    surface: '',
    icon: 'text-[var(--text-muted-inverse)]',
    title: 'text-[var(--text-inverse)]',
    duration: 'text-[var(--text-muted-inverse)]',
    name: {
      parent: 'text-[var(--text-inverse)]',
      child: 'text-[var(--text-muted-inverse)]',
    },
    bar: {
      parent: 'bg-[var(--text-inverse)] opacity-80',
      child: 'bg-[var(--text-inverse)] opacity-40',
    },
  },
  light: {
    outline: 'border-[var(--border-1)]',
    surface: 'bg-[var(--white)] shadow-xs dark:bg-[var(--surface-4)]',
    icon: 'text-[var(--text-icon)]',
    title: 'text-[var(--text-primary)]',
    duration: 'text-[var(--text-muted)]',
    name: {
      parent: 'text-[var(--text-primary)]',
      child: 'text-[var(--text-muted)]',
    },
    bar: {
      parent: 'bg-[var(--text-secondary)]',
      child: 'bg-[var(--text-muted)]',
    },
  },
} as const

/**
 * A run's block-by-block trace told inside the agent-code tile's outlined
 * window: the window keeps that tile's exact slot geometry (`top-5`,
 * `left-0`, bleeding off the right and bottom edges, `rounded-tl-xl`) and
 * takes its hairlines, fill, and inks from {@link TONE_STYLES}. Its `h-12`
 * title bar pairs the Library icon (in an outlined `size-6` icon box, the
 * agent-code header's treatment) with the run's workflow name and the
 * run's total duration in mono on the right.
 *
 * Inside, the workspace trace view's vocabulary at tile scale: each span
 * is a row with its block name (children indented and quieter, the real
 * tree's depth ramp), a waterfall bar offset by when the span started
 * and sized by how long it ran, and a right-aligned mono duration. The
 * rows stamp in top to bottom once (from `run-trace-graphic.module.css`,
 * the agent-code tile's one-shot settle); under `prefers-reduced-motion`
 * the trace renders fully settled.
 *
 * Homepage portrait blocs inset the window on all sides with the landing
 * stage radius so the trace does not clip the tall card's corners, and
 * pass {@link RunTraceGraphicTone} `light` so the trace sits on the same
 * white window chrome as the rail's other product cards. The Logs page's
 * dark feature tile keeps the default `dark` palette.
 */
export function RunTraceGraphic({ variant = 'tile', tone = 'dark' }: RunTraceGraphicProps) {
  const portrait = variant === 'portrait'
  const palette = TONE_STYLES[tone]

  return (
    <FeatureGraphicShell variant={variant}>
      <div
        aria-hidden='true'
        className={cn(
          'absolute flex flex-col',
          portrait
            ? cn('inset-[10px] overflow-hidden border', LANDING_STAGE_WINDOW_RADIUS)
            : 'top-5 right-0 bottom-0 left-0 rounded-tl-xl border-t border-l',
          palette.outline,
          palette.surface
        )}
      >
        <div className={cn('flex h-12 shrink-0 items-center gap-2 border-b px-4', palette.outline)}>
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-md border',
              palette.outline
            )}
          >
            <Library className={cn('size-[14px]', palette.icon)} />
          </span>
          <span className={cn('min-w-0 flex-1 truncate text-base', palette.title)}>
            Support ticket routing
          </span>
          <span className={cn('shrink-0 font-mono text-caption', palette.duration)}>1.86s</span>
        </div>

        <div className={cn('flex flex-col p-4', portrait && 'min-h-0 flex-1 justify-evenly py-5')}>
          {TRACE_SPANS.map((span, index) => (
            <div
              key={span.name}
              className={cn('flex h-9 items-center gap-3', ROW_STEP_CLASSES[index])}
            >
              <span
                className={cn(
                  'w-[38%] shrink-0 truncate text-caption',
                  palette.name[span.barTone],
                  span.indentClass
                )}
              >
                {span.name}
              </span>
              <span className='relative h-full min-w-0 flex-1'>
                <span
                  className={cn(
                    '-translate-y-1/2 absolute top-1/2 h-[6px] rounded-full',
                    palette.bar[span.barTone],
                    span.barClass
                  )}
                />
              </span>
              <span
                className={cn('w-11 shrink-0 text-right font-mono text-caption', palette.duration)}
              >
                {span.duration}
              </span>
            </div>
          ))}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
