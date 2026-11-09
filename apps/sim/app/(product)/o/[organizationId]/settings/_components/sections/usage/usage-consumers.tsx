'use client'

import type { ReactNode } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { FailureNotice } from '@sim/emcn/status'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'
import type {
  OrganizationUsageBreakdown,
  UsageBreakdownDimension,
  UsageList,
} from '@/platform/lib/data/usage'
import { EMPTY_COPY } from '@/platform/shared/usage'

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
  const unattributed = dimension === 'workspace' && !row.id
  return (
    <TableLabel
      leading={
        dimension === 'member' ? (
          <Avatar size='inline' name={row.label} src={row.image ?? undefined} />
        ) : row.providerId ? (
          <Icon providerId={row.providerId} />
        ) : undefined
      }
    >
      <OverflowText
        text={row.label}
        fullValue={unattributed ? `${row.label}. ${UNATTRIBUTED_INFO}` : row.label}
      >
        {row.label}
      </OverflowText>
    </TableLabel>
  )
}

interface UsageConsumersProps {
  title: string
  dimension: UsageBreakdownDimension
  list: UsageList
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
  list,
  control,
  onSelectRow,
  onManageCredits,
  onExpandOther,
}: UsageConsumersProps) {
  const { data: breakdown, loading, failed, dimmed, retry: onRetry } = list
  if (failed) return <FailureNotice message={`Couldn’t load ${title}.`} onRetry={onRetry} />
  if (loading || !breakdown) return null
  if (breakdown.rows.length === 0)
    return <EmptyState title={title} description={EMPTY_COPY[dimension]} action={control} />
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
                  icon='I108'
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
