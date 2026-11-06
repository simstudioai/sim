'use client'

import { type ReactNode, useRef, useState } from 'react'
import type {
  OrganizationUsageBreakdown,
  UsageBreakdownDimension,
} from '@/lib/api/contracts/organization-usage'
import {
  ActionMenu,
  Avatar,
  DataTable,
  EmptyState,
  FailureNotice,
  OverflowText,
  TableLabel,
} from '@/platform/design-system/components'
import { AnchoredPopover } from '@/platform/design-system/components/menu/anchored-popover'
import { ProviderMark } from '@/platform/embedded/app/(shell)/_components/provider-mark/provider-mark'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import { EMPTY_COPY, type UsageList } from '@/platform/embedded/lib/data/usage'

type BreakdownRow = OrganizationUsageBreakdown['rows'][number]

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'share', label: 'Share', kind: 'percent', showFrom: 'compact' },
  { key: 'credits', label: 'Credits', kind: 'number' },
] as const

const UNATTRIBUTED_INFO = 'Includes organization-wide activity and charges from deleted workspaces.'

/** Opens on click or tap as well as on hover, so the explanation never depends on a pointer. */
function UnattributedInfo({ label }: { label: string }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <span ref={anchor}>
      <AnchoredPopover
        label={label}
        presentation='panel'
        icon='I047'
        anchor={anchor}
        open={open}
        onOpenChange={setOpen}
      >
        <p className={styles.infoPanel} data-type='T060'>
          {UNATTRIBUTED_INFO}
        </p>
      </AnchoredPopover>
    </span>
  )
}

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
          <ProviderMark providerId={row.providerId} />
        ) : undefined
      }
    >
      <OverflowText text={row.label}>{row.label}</OverflowText>
      {unattributed && <UnattributedInfo label={`About ${row.label.toLowerCase()}`} />}
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
  const state = failed ? (
    <FailureNotice message={`Couldn’t load ${title}.`} onRetry={onRetry} />
  ) : loading || !breakdown ? (
    <span className={styles.listPlaceholder} role='status' aria-label={`Loading ${title}`} />
  ) : breakdown.rows.length === 0 ? (
    <EmptyState title={EMPTY_COPY[dimension]} />
  ) : null
  if (state || !breakdown)
    return (
      <section className={styles.block} aria-label={title}>
        <div className={styles.tableHeading}>
          <h2 data-type='T042'>{title}</h2>
          {control}
        </div>
        {state}
      </section>
    )
  return (
    <div className={styles.dimmable} data-dimmed={dimmed || undefined}>
      <DataTable
        title={title}
        control={control}
        columns={COLUMNS}
        rows={[
          ...breakdown.rows.map((row) => ({
            id: `${dimension}-${row.id ?? row.label}`,
            values: {
              name: row.label,
              share: row.share,
              credits: dimension === 'byok' ? (row.tokens ?? 0) : row.credits,
            },
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
                    credits:
                      dimension === 'byok' ? breakdown.other.tokens : breakdown.other.credits,
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
