'use client'

import { useMemo } from 'react'
import { ChipLink } from '@sim/emcn'
import { formatDateTime } from '@sim/utils/formatting'
import { SettingsActionChip } from '@/components/settings/settings-header'
import type { SecretUsageEntryPayload, SecretUsageScope } from '@/lib/api/contracts'
import { DELETED_WORKFLOW_LABEL } from '@/lib/workflows/workflow-labels'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components'
import { TriggerBadge } from '@/app/workspace/[workspaceId]/logs/utils'
import {
  ActivityLog,
  type ActivityLogEntry,
} from '@/app/workspace/[workspaceId]/settings/components/activity-log'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useSecretUsage } from '@/hooks/queries/credentials'

/**
 * The disabled twin of the View log chip, for a run whose log has been pruned. Routed through
 * the shared settings chip so it carries the platform's disabled tooltip treatment — including
 * the pointer-events handling a disabled button needs for the tooltip to fire at all.
 */
const EXPIRED_LOG_ACTION = {
  id: 'view-log',
  text: 'View log',
  disabled: true,
  tooltip: 'This run\u2019s log is past your workspace\u2019s retention window',
  onSelect: () => {},
} as const

interface SecretUsagePanelProps {
  workspaceId: string
  secretName: string
  scope: SecretUsageScope
}

/** What used the secret, in the reader's terms rather than the storage enum's. */
function usedBy(entry: SecretUsageEntryPayload): string {
  if (entry.source === 'copilot') return 'Sim agent'
  if (entry.source === 'mcp') return 'MCP server'
  return entry.workflowName ?? DELETED_WORKFLOW_LABEL
}

/**
 * One secret's usage trail.
 *
 * Rows are per-day buckets, so the timestamp is the most recent use in that day and the run
 * count only appears when it is above one — a "1 run" on every row is noise, not data. The
 * trigger badge is the Logs page's own, so a row reads the same here as at the run it links to.
 */
export function SecretUsagePanel({ workspaceId, secretName, scope }: SecretUsagePanelProps) {
  const { data, isPending, isError } = useSecretUsage({ workspaceId, name: secretName, scope })

  const entries = useMemo<ActivityLogEntry[]>(
    () =>
      (data?.entries ?? []).map((entry) => ({
        id: entry.id,
        timestamp: formatDateTime(new Date(entry.lastUsedAt)),
        event: <TriggerBadge trigger={entry.lastTrigger ?? entry.source} />,
        /**
         * Plain text, so the name sits flush under its column header — a chip's own
         * padding would indent it out of line with every other column.
         */
        description: (
          <span className='flex min-w-0 items-center gap-2'>
            <FloatingOverflowText label={usedBy(entry)} className='block' />
            {entry.useCount > 1 && (
              <span className='flex-shrink-0 text-[var(--text-muted)]'>{entry.useCount} runs</span>
            )}
          </span>
        ),
        actor: entry.actorName ?? 'Unknown',
        /**
         * Three states, not two. A row with no execution id never had a run to link (Sim agent
         * and MCP resolutions have none). A row whose run has since been pruned — usage
         * outlives logs on purpose — keeps the chip but disables it, so the reader learns the
         * log expired instead of clicking into an empty Logs view.
         *
         * `border` is the outline-only variant: a bare chip renders as unadorned
         * `--text-body` text at `text-sm`, which next to the Actor cell's `--text-secondary`
         * `text-small` reads as one more data column rather than a control. The outline is
         * the lightest chrome that says "this is a button" without adding a fill to every row.
         * The negative margin lets the 30px pill overhang the row's text line instead of
         * growing it, so a row with a link is the same height as one without.
         */
        trailing: entry.lastExecutionId ? (
          entry.lastExecutionAvailable ? (
            <ChipLink
              href={`/workspace/${workspaceId}/logs?executionId=${entry.lastExecutionId}`}
              variant='border'
              className='-my-1'
            >
              View log
            </ChipLink>
          ) : (
            <span className='-my-1 inline-flex'>
              <SettingsActionChip action={EXPIRED_LOG_ACTION} />
            </span>
          )
        ) : undefined,
      })),
    [data?.entries, workspaceId]
  )

  if (isError) {
    return (
      <SettingsEmptyState variant='inline' tone='error'>
        Could not load usage.
      </SettingsEmptyState>
    )
  }

  return (
    <ActivityLog
      entries={entries}
      eventLabel='Trigger'
      descriptionLabel='Used by'
      eventColumn='compact'
      emptyState={
        <SettingsEmptyState variant='inline'>
          {isPending ? 'Loading…' : 'This secret has not been used yet.'}
        </SettingsEmptyState>
      }
    />
  )
}
