import { cn } from '@sim/emcn'
import { Database } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/knowledge/components/feature-graphics/knowledge-query-graphic.module.css'

interface CodeSegment {
  /** Segment text. */
  text: string
  /** Ink treatment on the dark tile: `muted` scaffolding or `primary` payload. */
  tone?: 'muted' | 'primary'
}

/**
 * A knowledge search step inside an agent's logic - retrieve the passages
 * that ground the answer, then answer from them.
 */
const CODE_LINES: readonly CodeSegment[][] = [
  [
    { text: 'const', tone: 'muted' },
    { text: ' ' },
    { text: 'docs', tone: 'primary' },
    { text: ' ' },
    { text: '= await', tone: 'muted' },
    { text: ' ' },
    { text: 'knowledge', tone: 'primary' },
  ],
  [{ text: '  .search({' }],
  [
    { text: '    ' },
    { text: 'base:', tone: 'muted' },
    { text: ' ' },
    { text: "'Support KB'", tone: 'primary' },
    { text: ',' },
  ],
  [
    { text: '    ' },
    { text: 'query:', tone: 'muted' },
    { text: ' ' },
    { text: 'ticket.question', tone: 'primary' },
    { text: ',' },
  ],
  [{ text: '  })' }],
  [
    { text: 'return', tone: 'muted' },
    { text: ' ' },
    { text: 'agent.answer({ docs })', tone: 'primary' },
  ],
] as const

/** Per-line stamp-in classes - the stagger order is baked into each class's delay. */
const LINE_STEP_CLASSES = [
  styles.line0,
  styles.line1,
  styles.line2,
  styles.line3,
  styles.line4,
  styles.line5,
] as const

/** Segment inks on the dark tile - the deploy tile's dark-surface palette. */
const SEGMENT_TONE_CLASS = {
  muted: 'text-[var(--text-muted-inverse)]',
  primary: 'text-[var(--text-inverse)]',
} as const

/** Shared hairline ink for the window outline, header rule, and icon box. */
const OUTLINE_INK = 'border-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'

/**
 * Knowledge retrieval inside agent logic, told in the agent-code tile's
 * dark-outline vocabulary: the same outlined editor window (`top-5`,
 * `left-0`, bleeding off the right and bottom edges, `rounded-tl-xl`,
 * faint `--text-muted-inverse` hairlines with the dark tile showing
 * through), its `h-12` title bar pairing a `Database` mark in an outlined
 * `size-6` icon box with the `answer-bot.ts` filename over a hairline
 * rule.
 *
 * Inside, a knowledge search step sits settled in mono - scaffolding in
 * `--text-muted-inverse`, payload in `--text-inverse` - retrieving the
 * Support KB passages that ground the agent's answer, with a blinking
 * caret holding the last line. The lines stamp in top to bottom once
 * (from `knowledge-query-graphic.module.css`, the audit tile's one-shot
 * settle); under `prefers-reduced-motion` the excerpt renders fully
 * settled with no caret blink.
 */
export function KnowledgeQueryGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className={cn(
          'absolute top-5 right-0 bottom-0 left-0 rounded-tl-xl border-t border-l',
          OUTLINE_INK
        )}
      >
        <div className={cn('flex h-12 items-center gap-2 border-b px-4', OUTLINE_INK)}>
          <span
            className={cn('flex size-6 items-center justify-center rounded-md border', OUTLINE_INK)}
          >
            <Database className='size-[14px] text-[var(--text-muted-inverse)]' />
          </span>
          <span className='font-medium text-[var(--text-inverse)] text-base'>answer-bot.ts</span>
        </div>

        <div className='space-y-2 p-4 font-mono text-[var(--text-muted-inverse)] text-caption leading-[1.7]'>
          {CODE_LINES.map((line, index) => (
            <div key={index} className={cn('flex gap-3', LINE_STEP_CLASSES[index])}>
              <span className='w-3 select-none text-right text-[var(--text-muted-inverse)]'>
                {index + 1}
              </span>
              <code className='truncate whitespace-pre'>
                {line.map((segment, segmentIndex) => (
                  <span
                    key={segmentIndex}
                    className={segment.tone && SEGMENT_TONE_CLASS[segment.tone]}
                  >
                    {segment.text}
                  </span>
                ))}
                {index === CODE_LINES.length - 1 && (
                  <span className='ml-px inline-block h-[1.1em] w-px translate-y-[2px] animate-pulse bg-[var(--text-inverse)] align-text-bottom motion-reduce:animate-none' />
                )}
              </code>
            </div>
          ))}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
