'use client'

import {
  Chip,
  OverflowText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@sim/emcn'
import { formatDuration } from '@sim/utils/formatting'
import { MemberAvatar } from '@/components/member-avatar/member-avatar'
import type { OrganizationActivityBreakdown } from '@/lib/api/contracts/organization-activity'
import type { ActivityDimension } from '@/lib/billing/core/organization-activity'
import { formatFailureRate } from '@/ee/organization-usage/components/activity-summary'

interface ActivityTableProps {
  rows: OrganizationActivityBreakdown['rows']
  dimension: ActivityDimension
  onSelectWorkspace(id: string): void
}

const DIMENSION_LABELS: Record<ActivityDimension, string> = {
  workspace: 'Workspace',
  workflow: 'Workflow',
  member: 'Member',
  trigger: 'Trigger',
}

export function ActivityTable({ rows, dimension, onSelectWorkspace }: ActivityTableProps) {
  const isMember = dimension === 'member'
  return (
    <div className='-mx-2'>
      <Table variant='list'>
        <TableHeader>
          <TableRow>
            <TableHead scope='col'>{DIMENSION_LABELS[dimension]}</TableHead>
            {!isMember && (
              <TableHead scope='col' className='whitespace-nowrap text-right'>
                Workflow runs
              </TableHead>
            )}
            {(isMember || dimension === 'workspace') && (
              <TableHead scope='col' className='whitespace-nowrap text-right'>
                Chat runs
              </TableHead>
            )}
            {!isMember && (
              <>
                {dimension !== 'workspace' && (
                  <TableHead scope='col' className='text-right'>
                    Failed
                  </TableHead>
                )}
                <TableHead scope='col' className='whitespace-nowrap text-right'>
                  Failure rate
                </TableHead>
                <TableHead scope='col' className='whitespace-nowrap text-right'>
                  Avg. duration
                </TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='max-w-[220px]'>
                {dimension === 'workspace' && row.workspaceId ? (
                  <Chip
                    onClick={() => {
                      if (row.workspaceId) onSelectWorkspace(row.workspaceId)
                    }}
                    className='max-w-full'
                  >
                    {row.label}
                  </Chip>
                ) : (
                  <div className='flex min-w-0 items-center gap-2.5'>
                    {isMember && <MemberAvatar name={row.label} image={row.image ?? null} />}
                    <OverflowText label={row.label} className='text-[var(--text-body)] text-sm' />
                  </div>
                )}
                {dimension === 'workflow' && row.workspaceName && (
                  <OverflowText
                    label={row.workspaceName}
                    className='text-[var(--text-muted)] text-caption'
                  />
                )}
              </TableCell>
              {!isMember && (
                <TableCell className='text-right tabular-nums'>
                  {row.workflowRuns.toLocaleString()}
                </TableCell>
              )}
              {(isMember || dimension === 'workspace') && (
                <TableCell className='text-right tabular-nums'>
                  {row.chatRuns.toLocaleString()}
                </TableCell>
              )}
              {!isMember && (
                <>
                  {dimension !== 'workspace' && (
                    <TableCell className='text-right tabular-nums'>
                      {row.failed.toLocaleString()}
                    </TableCell>
                  )}
                  <TableCell className='text-right tabular-nums'>
                    {formatFailureRate(row.failureRate)}
                  </TableCell>
                  <TableCell className='whitespace-nowrap text-right tabular-nums'>
                    {row.averageDurationMs === null
                      ? '—'
                      : row.averageDurationMs === 0
                        ? '0 ms'
                        : formatDuration(row.averageDurationMs, { precision: 2 })}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
