import { ChipTag, cn } from '@sim/emcn'
import { ConfluenceIcon, GoogleDriveIcon, NotionIcon } from '@/components/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/knowledge/components/feature-graphics/connector-sync-graphic.module.css'

interface ConnectorRow {
  /** Connector brand mark. */
  icon: React.ComponentType<{ className?: string }>
  /** Connector name. */
  name: string
  /** Document count attribution line. */
  documents: string
  /** Right-aligned sync status. */
  status: string
  /** Whether this row is the mid-sync one carrying the live beat. */
  syncing?: boolean
}

/**
 * Three sources feeding one knowledge base: Notion mid-sync as the live
 * beat, Drive and Confluence settled from earlier passes.
 */
const CONNECTOR_ROWS: readonly ConnectorRow[] = [
  {
    icon: NotionIcon,
    name: 'Notion',
    documents: '128 docs',
    status: 'Syncing',
    syncing: true,
  },
  {
    icon: GoogleDriveIcon,
    name: 'Google Drive',
    documents: '342 docs',
    status: 'Synced · 2m ago',
  },
  {
    icon: ConfluenceIcon,
    name: 'Confluence',
    documents: '96 docs',
    status: 'Synced · 1h ago',
  },
] as const

/** Per-row stamp-in classes - the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2] as const

/**
 * Source syncing told as a frameless connector ledger (the audit tile's
 * composition): a small "Connectors" header with an `Auto-sync` mono
 * ChipTag (fill stepped up to `--surface-6` so the pill stays legible on
 * the grey ground) above three source rows, each a white card in the
 * audit tile's exact chrome (`--white` fill, 1px `--border-1` hairline,
 * `rounded-xl`, `shadow-sm`) pairing the connector's real brand mark in
 * the lifecycle header's outlined `size-6` icon box with the source name,
 * its document count, and a right-aligned sync status. The top row is
 * mid-sync - a pulsing dot beside "Syncing" and the family's quiet 6s
 * ring pulse on its icon box - while the settled rows read "Synced".
 *
 * Motion (from `connector-sync-graphic.module.css`): the rows stamp in
 * top to bottom once - the audit tile's one-shot settle, never re-played -
 * then the syncing row's icon box carries the shared ring-pulse beat. The
 * dot blink is Tailwind's `animate-pulse` with its own
 * `motion-reduce:animate-none`; everything renders settled under
 * `prefers-reduced-motion`.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center. The column is fluid
 * (`w-full max-w-[312px]`), relaxing to 400px on the wide spanned tile of
 * the two-column band (container ≥500px inside `sm`..`lg`).
 */
export function ConnectorSyncGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px] sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'>
          <div className='mb-4 flex items-center justify-between'>
            <span className='font-medium text-[var(--text-primary)] text-base'>Connectors</span>
            <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
              Auto-sync
            </ChipTag>
          </div>

          <div className='flex flex-col gap-2'>
            {CONNECTOR_ROWS.map((row, index) => (
              <div
                key={row.name}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm',
                  ROW_STEP_CLASSES[index]
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-1)]',
                    row.syncing && styles.iconPulse
                  )}
                >
                  <row.icon className='size-[14px]' />
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate font-medium text-[var(--text-primary)] text-small'>
                    {row.name}
                  </span>
                  <span className='block truncate text-[var(--text-muted)] text-caption'>
                    {row.documents}
                  </span>
                </span>
                <span className='flex shrink-0 items-center gap-1.5 text-[var(--text-muted)] text-caption'>
                  {row.syncing && (
                    <span className='size-1.5 animate-pulse rounded-full bg-[var(--text-secondary)] motion-reduce:animate-none' />
                  )}
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
