'use client'

import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import {
  ActionMenu,
  Avatar,
  DataTable,
  EmptyState,
  Icon,
  OverflowText,
  Tooltip,
} from '@/platform/design-system/components'
import {
  EMPTY_COPY,
  type OrganizationUsageBreakdown,
  type UsageBreakdownDimension,
} from '@/platform/lib/data/usage'

type BreakdownRow = OrganizationUsageBreakdown['rows'][number]

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'share', label: 'Share', kind: 'percent', showFrom: 'compact' },
  { key: 'credits', label: 'Credits', kind: 'number' },
] as const

const UNATTRIBUTED_INFO = 'Includes organization-wide activity and charges from deleted workspaces.'

function ConsumerName({
  row,
  dimension,
}: {
  row: BreakdownRow
  dimension: UsageBreakdownDimension
}) {
  const name = <OverflowText text={row.label}>{row.label}</OverflowText>
  let content: ReactNode = name
  if (dimension === 'workspace' && !row.id) {
    content = (
      <Tooltip label={UNATTRIBUTED_INFO}>
        <span>{name}</span>
      </Tooltip>
    )
  }
  return (
    <span className={styles.nameCell}>
      {dimension === 'member' ? (
        <Avatar size='inline' name={row.label} src={row.image ?? undefined} />
      ) : (
        row.providerId && <Icon providerId={row.providerId} />
      )}
      {content}
    </span>
  )
}

interface UsageConsumersProps {
  title: string
  dimension: UsageBreakdownDimension
  breakdown?: OrganizationUsageBreakdown
  loading: boolean
  failed: boolean
  dimmed?: boolean
  control?: ReactNode
  /** Set on Workspaces, where a row drills into that workspace's workflows. */
  onSelectRow?: (row: BreakdownRow) => void
  /** Set on Members, where a row can open the credit limit editor. */
  onManageCredits?: (row: BreakdownRow) => void
  /** Opens the truncated tail; absent once the list shows all the API will return. */
  onExpandOther?: () => void
}

/**
 * A ranked list. Its tail stays named rather than dropped, since a list that does not add up to the
 * headline figure is how "the numbers are wrong" reports start.
 */
export function UsageConsumers({
  title,
  dimension,
  breakdown,
  loading,
  failed,
  dimmed,
  control,
  onSelectRow,
  onManageCredits,
  onExpandOther,
}: UsageConsumersProps) {
  if (failed) return <EmptyState title={title} description='Couldn’t load this view.' />
  if (loading || !breakdown)
    return <span className={styles.listPlaceholder} role='status' aria-label={`Loading ${title}`} />
  if (breakdown.rows.length === 0)
    return <EmptyState title={title} description={EMPTY_COPY[dimension]} />
  return (
    <div className={styles.dimmable} data-dimmed={dimmed || undefined}>
      <DataTable
        title={title}
        control={control}
        columns={COLUMNS}
        rows={[
          ...breakdown.rows.map((row) => ({
            id: `${dimension}-${row.id ?? row.label}`,
            values: { name: row.label, share: row.share, credits: row.credits },
            cells: { name: <ConsumerName row={row} dimension={dimension} /> },
            onOpen: onSelectRow && row.id ? () => onSelectRow(row) : undefined,
            action:
              onManageCredits && row.id ? (
                <ActionMenu
                  label={`${row.label} actions`}
                  align='end'
                  actions={[
                    {
                      id: 'credits',
                      label: 'Manage credits',
                      onSelect: () => onManageCredits(row),
                    },
                  ]}
                />
              ) : undefined,
          })),
          ...(breakdown.other.rowCount > 0
            ? [
                {
                  id: `${dimension}-other`,
                  values: {
                    name: `Other (${breakdown.other.rowCount} more)`,
                    credits: breakdown.other.credits,
                  },
                  onOpen: onExpandOther,
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}
