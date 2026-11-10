'use client'

import { Button } from '@sim/emcn/button'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import Link from 'next/link'
import { workspacePath } from '@/lib/navigation/paths'
import {
  BLOCK_NAMES,
  DELETED_WORKFLOW_LABEL,
  type SecretUsageEntryPayload,
  type SecretUsageScope,
  useSecretUsage,
} from '@/platform/lib/data/secrets'
import { usePlatformHref } from '@/platform/lib/navigation'
import { formatTimestamp } from '@/platform/shared/time'
import { coreTriggerLabel } from '@/platform/shared/trigger-labels'

function triggerLabel(trigger: string) {
  return (
    coreTriggerLabel(trigger) ??
    BLOCK_NAMES[trigger] ??
    trigger
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}

/** What used the secret, in the reader's terms rather than the storage enum's. */
function usedBy(entry: SecretUsageEntryPayload) {
  if (entry.source === 'copilot') return 'Sim agent'
  if (entry.source === 'mcp') return 'MCP server'
  return entry.workflowName ?? DELETED_WORKFLOW_LABEL
}

const COLUMNS = [
  { key: 'timestamp', label: 'Timestamp', kind: 'text', width: 'compact' },
  { key: 'trigger', label: 'Trigger', kind: 'text', width: 'compact' },
  { key: 'usedBy', label: 'Used by', kind: 'text', primary: true },
  { key: 'actor', label: 'Actor', kind: 'text', showFrom: 'wide' },
] as const

interface SecretUsageProps {
  workspaceId: string
  secretName: string
  scope: SecretUsageScope
}

/**
 * One secret's usage trail. Rows are per-day buckets: the time is the day's latest use, and a run
 * count shows only above one. A run whose log has aged out keeps its link, disabled with the reason.
 */
export function SecretUsage({ workspaceId, secretName, scope }: SecretUsageProps) {
  const hrefFor = usePlatformHref()
  const { data, isPending, isError, isFetching, refetch } = useSecretUsage({
    workspaceId,
    name: secretName,
    scope,
  })

  if (isError)
    return (
      <FailureNotice
        message='Could not load usage.'
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )
  if (isPending) return null
  if (data.entries.length === 0) return <EmptyState title='This secret has not been used yet.' />

  return (
    <DataTable
      title='Secret usage'
      titleHidden
      columns={COLUMNS}
      rowActions
      rows={data.entries.map((entry) => ({
        id: entry.id,
        values: {
          timestamp: formatTimestamp(new Date(entry.lastUsedAt).getTime()),
          trigger: triggerLabel(entry.lastTrigger ?? entry.source),
          usedBy: entry.useCount > 1 ? `${usedBy(entry)} · ${entry.useCount} runs` : usedBy(entry),
          actor: entry.actorName ?? 'Unknown',
        },
        action: entry.lastExecutionId ? (
          entry.lastExecutionAvailable ? (
            <Button
              size='compact'
              variant='quiet'
              render={
                <Link
                  href={hrefFor(
                    workspacePath(workspaceId, `logs/${encodeURIComponent(entry.lastExecutionId)}`)
                  )}
                />
              }
            >
              View log
            </Button>
          ) : (
            <Button
              size='compact'
              variant='quiet'
              disabled
              disabledReason='This run’s log is past your workspace’s retention window'
            >
              View log
            </Button>
          )
        ) : undefined,
      }))}
    />
  )
}
