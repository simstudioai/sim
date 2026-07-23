import { ChipTag, cn } from '@sim/emcn'
import { AgentIcon } from '@/components/icons'
import { CsvIcon, DocxIcon, PdfIcon } from '@/components/icons/document-icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/files/components/feature-graphics/file-library-graphic.module.css'

interface LibraryRow {
  /** File name in the row's leading position. */
  name: string
  /** Document-type glyph beside the name. */
  icon: React.ComponentType<{ className?: string }>
  /** Attribution line - "owner · size". */
  meta: string
  /** Right-aligned relative timestamp. */
  time: string
  /** Marks the owner as a Sim agent, rendering the agent glyph on the badge. */
  agent?: boolean
}

/**
 * The library vignette's four rows - the newest an agent-produced report
 * on the highlight card, the rest a mix of human uploads and agent
 * artifacts so the shared-store story reads in one glance.
 */
const ROWS: readonly [LibraryRow, LibraryRow, LibraryRow, LibraryRow] = [
  {
    name: 'weekly-report.pdf',
    icon: PdfIcon,
    meta: 'Report agent · 1.8 MB',
    time: 'Now',
    agent: true,
  },
  {
    name: 'brand-guidelines.pdf',
    icon: PdfIcon,
    meta: 'Maya Chen · 5.1 MB',
    time: '2h ago',
  },
  {
    name: 'invoice-batch-march.csv',
    icon: CsvIcon,
    meta: 'Invoice agent · 812 KB',
    time: 'Yesterday',
    agent: true,
  },
  {
    name: 'onboarding-playbook.docx',
    icon: DocxIcon,
    meta: 'Jordan Lee · 1.1 MB',
    time: 'Jun 12',
  },
] as const

/** Per-row ink treatments, quieter with age like the audit ledger. */
const ROW_TONES = [
  'text-[var(--text-primary)]',
  'text-[var(--text-secondary)]',
  'text-[var(--text-muted)]',
  'text-[var(--text-muted)]',
] as const

/** Per-index stamp-in classes — the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2, styles.row3] as const

/** The owner badge - an outlined circle holding the agent glyph or nothing. */
function OwnerBadge({ row }: { row: LibraryRow }) {
  return (
    <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] text-[var(--text-icon)]'>
      {row.agent ? <AgentIcon className='size-[13px]' /> : <row.icon className='size-[14px]' />}
    </span>
  )
}

/**
 * Sim's shared file library told as a frameless, centered vignette (the
 * audit tile's composition): a small "Files" header with a `Shared` mono
 * ChipTag (fill stepped up to `--surface-6` so the pill stays legible on
 * the grey ground) above four library rows - a document-type icon box,
 * the file name in the row's regular sans face, an "owner · size"
 * attribution line, and a right-aligned timestamp. Human uploads and
 * agent-produced artifacts sit interleaved, which is the tile's whole
 * claim. The newest record - an agent's report, written seconds ago - is
 * the selected row: it sits on a solid white card wearing the family's
 * highlight chrome exactly (`--white` fill, 1px `--border-1` hairline,
 * `rounded-xl`, `shadow-sm`), while older rows rest directly on the tile
 * and quieten with age until a mask gradient dissolves the oldest.
 *
 * Motion (from `file-library-graphic.module.css`): the rows stamp in top
 * to bottom once - the audit tile's one-shot settle, never re-played -
 * and are removed under `prefers-reduced-motion`.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center. On the wide spanned tile
 * of the two-column band (container ≥500px inside `sm`..`lg`) the column
 * relaxes to 400px, matching the family's wide-tile measure.
 */
export function FileLibraryGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px] sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'>
          <div className='mb-4 flex items-center justify-between'>
            <span className='font-medium text-[var(--text-primary)] text-base'>Files</span>
            <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
              Shared
            </ChipTag>
          </div>

          <div className='flex flex-col gap-1.5 [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]'>
            {ROWS.map((row, index) => {
              const newest = index === 0

              return (
                <div
                  key={row.name}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5',
                    ROW_STEP_CLASSES[index],
                    newest &&
                      'rounded-xl border border-[var(--border-1)] bg-[var(--white)] shadow-sm'
                  )}
                >
                  <OwnerBadge row={row} />
                  <span className='min-w-0 flex-1'>
                    <span className={cn('block truncate font-medium text-small', ROW_TONES[index])}>
                      {row.name}
                    </span>
                    <span className='block truncate text-[var(--text-muted)] text-caption'>
                      {row.meta}
                    </span>
                  </span>
                  <span className='shrink-0 self-start pt-px text-[var(--text-muted)] text-caption'>
                    {row.time}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
