import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import styles from '@/app/(landing)/components/shared/code-window-graphic/code-window-graphic.module.css'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'

/** One inline run of code text inside a {@link CodeWindowGraphic} line. */
export interface CodeSegment {
  /** Segment text. */
  text: string
  /** Ink treatment on the dark tile: `muted` scaffolding or `primary` payload. */
  tone?: 'muted' | 'primary'
}

interface CodeWindowGraphicProps {
  /**
   * Title-bar mark, rendered inside the outlined `size-6` icon box - pass a
   * `size-[14px]` icon in `--text-muted-inverse` to match the family.
   */
  icon: ReactNode
  /** Filename shown beside the icon in the title bar. */
  filename: string
  /** Code excerpt, one segment array per line - at most six lines animate. */
  lines: readonly (readonly CodeSegment[])[]
}

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
 * The dark-tile outlined editor window shared by the platform pages' "from
 * code" feature graphics (Workflows, Knowledge, Tables, Files): the
 * agent-code tile's exact slot geometry (`top-5`, `left-0`, bleeding off
 * the right and bottom edges, `rounded-tl-xl`) drawn as an outlined shell -
 * faint `--text-muted-inverse` hairlines with the dark tile showing
 * through, the deploy tile's browser-window vocabulary. Its `h-12` title
 * bar pairs the caller's icon (in an outlined `size-6` icon box, the
 * lifecycle header's treatment in dark ink) with the caller's filename
 * over a hairline rule.
 *
 * Inside, the caller's code excerpt sits settled in mono - scaffolding in
 * `--text-muted-inverse`, payload in `--text-inverse` - with a blinking
 * caret holding the last line. The lines stamp in top to bottom once (from
 * `code-window-graphic.module.css`, the audit tile's one-shot settle);
 * under `prefers-reduced-motion` the excerpt renders fully settled with no
 * caret blink.
 */
export function CodeWindowGraphic({ icon, filename, lines }: CodeWindowGraphicProps) {
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
            {icon}
          </span>
          <span className='font-medium text-[var(--text-inverse)] text-base'>{filename}</span>
        </div>

        <div className='space-y-2 p-4 font-mono text-[var(--text-muted-inverse)] text-caption leading-[1.7]'>
          {lines.map((line, index) => (
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
                {index === lines.length - 1 && (
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
