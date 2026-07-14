import { cn } from '@sim/emcn'
import { File } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/files/components/feature-graphics/files-sdk-graphic.module.css'

interface CodeSegment {
  /** Segment text. */
  text: string
  /** Ink treatment on the dark tile: `muted` scaffolding or `primary` payload. */
  tone?: 'muted' | 'primary'
}

/**
 * The `report-agent.ts` excerpt — an agent reading a file from the shared
 * store and writing its output back, the page's story reached from code.
 */
const CODE_LINES: readonly CodeSegment[][] = [
  [
    { text: 'import', tone: 'muted' },
    { text: ' ' },
    { text: '{ files }', tone: 'primary' },
    { text: ' ' },
    { text: 'from', tone: 'muted' },
    { text: ' ' },
    { text: "'@sim/sdk'", tone: 'primary' },
  ],
  [
    { text: 'const', tone: 'muted' },
    { text: ' ' },
    { text: 'brief', tone: 'primary' },
    { text: ' ' },
    { text: '= await', tone: 'muted' },
  ],
  [{ text: '  ' }, { text: "files.read('q3-brief.pdf')", tone: 'primary' }],
  [{ text: 'await', tone: 'muted' }, { text: ' ' }, { text: 'files.upload({', tone: 'primary' }],
  [
    { text: '  ' },
    { text: 'name:', tone: 'muted' },
    { text: ' ' },
    { text: "'weekly-report.pdf'", tone: 'primary' },
    { text: ',' },
  ],
  [
    { text: '  ' },
    { text: 'content:', tone: 'muted' },
    { text: ' ' },
    { text: 'draft(brief)', tone: 'primary' },
    { text: ',' },
  ],
] as const

/** Per-line stamp-in classes — the stagger order is baked into each class's delay. */
const LINE_STEP_CLASSES = [
  styles.line0,
  styles.line1,
  styles.line2,
  styles.line3,
  styles.line4,
  styles.line5,
] as const

/** Segment inks on the dark tile — the deploy tile's dark-surface palette. */
const SEGMENT_TONE_CLASS = {
  muted: 'text-[var(--text-muted-inverse)]',
  primary: 'text-[var(--text-inverse)]',
} as const

/** Shared hairline ink for the window outline, header rule, and icon box. */
const OUTLINE_INK = 'border-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'

/**
 * Files reached from code told inside the agent-code tile's editor window
 * in the dark tiles' outlined ink: the window keeps the family's exact
 * slot geometry (`top-5`, `left-0`, bleeding off the right and bottom
 * edges, `rounded-tl-xl`) as an outlined shell — faint
 * `--text-muted-inverse` hairlines with the dark tile showing through.
 * Its `h-12` title bar pairs the `File` icon (in an outlined `size-6`
 * icon box) with the `report-agent.ts` filename, over a hairline rule.
 *
 * Inside, the SDK excerpt reads a brief out of Sim's file store and
 * uploads the finished report back — scaffolding in
 * `--text-muted-inverse`, payload in `--text-inverse` — with a blinking
 * caret holding the last line. The lines stamp in top to bottom once
 * (from `files-sdk-graphic.module.css`, the audit tile's one-shot
 * settle); under `prefers-reduced-motion` the excerpt renders fully
 * settled with no caret blink.
 */
export function FilesSdkGraphic() {
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
            <File className='size-[14px] text-[var(--text-muted-inverse)]' />
          </span>
          <span className='font-medium text-[var(--text-inverse)] text-base'>report-agent.ts</span>
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
