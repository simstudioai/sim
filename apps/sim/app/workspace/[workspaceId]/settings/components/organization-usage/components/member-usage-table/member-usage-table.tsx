'use client'

import { Chip, Table, type TableColumn, TableIdentityCell } from '@sim/emcn'
import { dollarsToCredits, formatCredits } from '@/lib/billing/credits/conversion'
import type { CreditLimitTarget } from '@/app/workspace/[workspaceId]/settings/components/organization-usage/components/credit-limit-modal'
import type { MemberUsageRow } from '@/app/workspace/[workspaceId]/settings/components/organization-usage/types'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

const USAGE_COLUMN_WIDTH = 160
const LIMIT_COLUMN_WIDTH = 160
const ACTION_COLUMN_WIDTH = 120
/** Digit-aligned so the credit columns compare down the page. */
const NUMERIC_CELL_CLASS = 'tabular-nums'

function displayName(row: MemberUsageRow): string {
  return row.userName || row.userEmail || 'Unknown member'
}

/** Suppressed when the email is already standing in as the primary line. */
function displayEmail(row: MemberUsageRow): string | undefined {
  return row.userName ? (row.userEmail ?? undefined) : undefined
}

function toTarget(row: MemberUsageRow): CreditLimitTarget {
  return { userId: row.userId, name: row.userName ?? '', email: row.userEmail ?? '' }
}

interface MemberUsageTableProps {
  members: MemberUsageRow[]
  /** Whether the viewer may set limits — drives the trailing action column. */
  canManage: boolean
  searchTerm: string
  onSearchTermChange: (value: string) => void
  onEditLimit: (target: CreditLimitTarget) => void
}

/**
 * The organization's per-member credit breakdown: who has spent what this
 * billing period, the cap each member carries, and the way in to change it.
 *
 * Every member arrives in the single roster request the page already makes, so
 * the search filters in memory and the list is never paged.
 */
export function MemberUsageTable({
  members,
  canManage,
  searchTerm,
  onSearchTermChange,
  onEditLimit,
}: MemberUsageTableProps) {
  const query = searchTerm.trim().toLowerCase()
  const rows = query
    ? members.filter(
        (row) =>
          (row.userName ?? '').toLowerCase().includes(query) ||
          (row.userEmail ?? '').toLowerCase().includes(query)
      )
    : members

  const columns: TableColumn<MemberUsageRow>[] = [
    {
      key: 'member',
      header: 'Member',
      cell: (row) => <TableIdentityCell primary={displayName(row)} secondary={displayEmail(row)} />,
    },
    {
      key: 'used',
      header: 'Credits used',
      align: 'right',
      width: USAGE_COLUMN_WIDTH,
      cell: (row) => (
        <span className={NUMERIC_CELL_CLASS}>
          {dollarsToCredits(row.currentPeriodCost ?? 0).toLocaleString()}
        </span>
      ),
    },
    /**
     * `organizationCreditLimit` is the org-scoped cap
     * (`organization_member_usage_limit`) — the one the modal writes and the one
     * usage enforcement reads. Deliberately NOT `currentUsageLimit`, which is the
     * member's personal subscription cap and is nulled for org-scoped members, so
     * reading it here would report "No limit" for everyone.
     */
    {
      key: 'limit',
      header: 'Credit limit',
      align: 'right',
      width: LIMIT_COLUMN_WIDTH,
      cell: (row) => (
        <span className={NUMERIC_CELL_CLASS}>
          {row.organizationCreditLimit == null
            ? 'No limit'
            : formatCredits(row.organizationCreditLimit)}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'action',
            align: 'right' as const,
            width: ACTION_COLUMN_WIDTH,
            cell: (row: MemberUsageRow) => (
              <Chip variant='border' onClick={() => onEditLimit(toTarget(row))}>
                Set limit
              </Chip>
            ),
          },
        ]
      : []),
  ]

  return (
    <Table
      aria-label='Member credit usage'
      rows={rows}
      getRowId={(row) => row.userId}
      columns={columns}
      toolbar={{
        search: {
          value: searchTerm,
          onChange: onSearchTermChange,
          placeholder: 'Search members',
        },
      }}
      empty={
        <SettingsEmptyState variant='inline'>
          No members matching &quot;{searchTerm}&quot;
        </SettingsEmptyState>
      }
    />
  )
}
