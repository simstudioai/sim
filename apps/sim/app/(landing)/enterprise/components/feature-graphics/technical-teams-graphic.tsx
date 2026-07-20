import { ChipTag, cn } from '@sim/emcn'
import { CircleCheck } from '@sim/emcn/icons'
import Image from 'next/image'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/technical-teams-graphic.module.css'

export interface DiffLine {
  /** Gutter marker — space for context, `-` for removed, `+` for added. */
  marker: ' ' | '-' | '+'
  /** The code content after the marker. */
  code: string
}

/**
 * A one-word behavior change to the same `Support agent` config the
 * build tile types out — the surrounding config lines ground the excerpt
 * as real code while the `-`/`+` pair stays the focal point.
 */
const DIFF_LINES: readonly DiffLine[] = [
  { marker: ' ', code: "  name: 'Support agent'," },
  { marker: ' ', code: '  instructions:' },
  { marker: ' ', code: "    'Answer customer questions'," },
  { marker: ' ', code: '  tools: [zendesk, slack],' },
  { marker: '-', code: "  onError: 'retry'," },
  { marker: '+', code: "  onError: 'escalate'," },
  { marker: ' ', code: '})' },
] as const

/** Per-marker ink treatments: added strongest, removed and context quiet. */
const MARKER_TONES: Record<DiffLine['marker'], string> = {
  ' ': 'text-[var(--text-muted)]',
  '-': 'text-[var(--text-muted)] opacity-70',
  '+': 'text-[var(--text-primary)]',
}

/**
 * Technical collaboration told as a distilled code-review vignette, in
 * the frameless composition its row-mates share (the IT tile's policy
 * ledger, the operations tile's handoff): no window chrome and no header
 * — the tile leads straight with the change under review, a seven-line
 * mono excerpt of the Support-agent config sitting bare on the tile.
 * Context and removed lines read in quiet `--text-muted`, the single
 * added line carrying `--text-primary` ink so the edit is the first
 * thing read. The review's
 * verdict is the tile's one highlight: a white card in the audit tile's
 * exact chrome (`--white` fill, 1px `--border-1` hairline, `rounded-xl`,
 * `shadow-sm`) pairing the reviewer — gradient avatar (shared with the
 * access, audit, and staging tiles), name, and an "Approved these
 * changes" attribution line — with an `Approved` tag that carries the
 * tile's only motion, the family's shared quiet 6s ring pulse (from
 * `technical-teams-graphic.module.css`, removed under
 * `prefers-reduced-motion`). A closing hairline-ruled row counts the
 * resolved review threads, keeping the together-ness of the claim
 * without a second emphasis.
 *
 * The avatar asset is a grey radial gradient on a black square, so it
 * sits in a `rounded-full overflow-hidden` clip with a slight scale-up
 * to crop the black canvas past the circle's edge.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled
 * slot's center. On the wide spanned tile of the two-column band
 * (container ≥500px inside `sm`..`lg`) the column relaxes to 400px so
 * the diff lines and review card use the wide slot's measure.
 * The column is fluid (`w-full max-w-[312px]`) so it
 * never exceeds the compensated slot at narrow tile widths — diff lines
 * and the reviewer's attribution truncate instead of clipping.
 *
 * The diff excerpt and review verdict are parametrizable so other
 * landing pages (engineering, compliance) can retell the change-review
 * moment with their own domain's diff — a code change, a policy edit;
 * the defaults keep the enterprise page's Support-agent review
 * byte-identical. Chrome, motion, and layout never change with the copy.
 */
interface TechnicalTeamsGraphicProps {
  /** The mono diff excerpt, seven lines to keep the tile's vertical rhythm. */
  diffLines?: readonly DiffLine[]
  /** Reviewer's display name on the verdict card. */
  reviewerName?: string
  /** Attribution line beneath the reviewer's name. */
  reviewerAction?: string
  /** Grey tag carrying the verdict's pulsing state. */
  verdictTag?: string
  /** Closing hairline-ruled row label. */
  footerLabel?: string
  /** Right-aligned closing row detail. */
  footerDetail?: string
}

export function TechnicalTeamsGraphic({
  diffLines = DIFF_LINES,
  reviewerName = 'Jordan Lee',
  reviewerAction = 'Approved these changes',
  verdictTag = 'Approved',
  footerLabel = 'Review threads resolved',
  footerDetail = '2 of 2',
}: TechnicalTeamsGraphicProps = {}) {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px] sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'>
          <div className='px-3 font-mono text-caption leading-[1.8]'>
            {diffLines.map((line) => (
              <div
                key={`${line.marker}${line.code}`}
                className={cn('truncate whitespace-pre', MARKER_TONES[line.marker])}
              >
                {line.marker} {line.code}
              </div>
            ))}
          </div>

          <div className='mt-3 flex items-center gap-3 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm'>
            <span className='relative size-7 shrink-0 overflow-hidden rounded-full shadow-sm'>
              <Image
                src='/landing/team-avatar-2.jpg'
                alt=''
                width={28}
                height={28}
                className='size-full scale-110 object-cover'
              />
            </span>
            <span className='min-w-0 flex-1'>
              <span className='block truncate font-medium text-[var(--text-primary)] text-small'>
                {reviewerName}
              </span>
              <span className='block truncate text-[var(--text-muted)] text-caption'>
                {reviewerAction}
              </span>
            </span>
            <ChipTag variant='gray' className={cn('shrink-0', styles.approvedPulse)}>
              {verdictTag}
            </ChipTag>
          </div>

          <div className='mt-1.5 flex h-9 items-center gap-2 px-3'>
            <CircleCheck className='size-[13px] shrink-0 text-[var(--text-icon)]' />
            <span className='min-w-0 flex-1 truncate text-[var(--text-secondary)] text-caption'>
              {footerLabel}
            </span>
            <span className='shrink-0 text-[var(--text-muted)] text-caption'>{footerDetail}</span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
