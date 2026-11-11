'use client'

import { type ComponentProps, type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import {
  DetailHeader,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'

type TableProps = ComponentProps<typeof DataTable>

interface UsageLedgerProps {
  backLabel: string
  backHref: string
  title: string
  description: string
  /** The period's menu, at the toolbar's end. */
  period: ReactNode
  /** What the period adds up to, such as its total. */
  summary?: ReactNode
  columns: TableProps['columns']
  rows: TableProps['rows']
  loadMore: TableProps['loadMore']
  pending: boolean
  failed: boolean
  /** The rows on screen belong to the previous period while the new one loads. */
  dimmed: boolean
  retry: () => void
  /** What the ledger lists, lowercase, for its failure: `credit usage`. */
  subject: string
  emptyTitle: string
  /** Downloads the period's events as CSV. */
  onExport: () => Promise<void>
}

/**
 * Every credit-consuming event in a period, newest first: the organization's events under Insights
 * and the viewer's own under Subscription. Export sits in the header, beside the title it exports.
 */
export function UsageLedger({
  backLabel,
  backHref,
  title,
  description,
  period,
  summary,
  columns,
  rows,
  loadMore,
  pending,
  failed,
  dimmed,
  retry,
  subject,
  emptyTitle,
  onExport,
}: UsageLedgerProps) {
  const [exporting, setExporting] = useState(false)
  return (
    <>
      <DetailHeader
        backLabel={backLabel}
        backHref={backHref}
        title={title}
        description={description}
      >
        <Button
          icon='I049'
          disabled={rows.length === 0 || dimmed || exporting}
          onClick={async () => {
            setExporting(true)
            try {
              await onExport()
            } finally {
              setExporting(false)
            }
          }}
        >
          Export
        </Button>
      </DetailHeader>
      <SectionToolbar grow={summary}>{period}</SectionToolbar>
      {failed && rows.length === 0 ? (
        <FailureNotice message={`Couldn’t load ${subject}.`} onRetry={retry} />
      ) : pending ? null : rows.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <div className={styles.dimmable} data-dimmed={dimmed || undefined}>
          <DataTable title={title} titleHidden columns={columns} loadMore={loadMore} rows={rows} />
        </div>
      )}
    </>
  )
}
