'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import { RunDashboard } from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-dashboard/run-dashboard'
import {
  type RunFilterOption,
  RunList,
  type RunRowActions,
} from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-list/run-list'
import {
  RUN_TRIGGER_OPTIONS,
  type RunCommandsTarget,
  runExportHref,
  useLiveRuns,
  useRunCommands,
  useRunDashboard,
  useRunFilterOptions,
} from '@/platform/lib/data/logs'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { runListParams, serializeRunList } from '@/platform/lib/workspace-views'
import type { RunSummary } from '@/platform/shared/workspace-records'

interface LiveRunsProps {
  workspaceId: string
  /** The integrations the Trigger filter offers beside the core triggers, read on the server. */
  integrationTriggers: readonly RunFilterOption[]
}

/**
 * The workspace's runs, paged by the server in the URL's period, filters and sort, or legacy's
 * dashboard of them. A row's menu retries, stops and opens the run as legacy's does.
 */
export function LiveRuns({ workspaceId, integrationTriggers }: LiveRunsProps) {
  const router = useRouter()
  const search = useSearchParams()
  const [view] = useQueryStates(runListParams)
  const live = useLiveRuns(workspaceId, view)
  const dashboard = useRunDashboard(workspaceId, view)
  const options = useRunFilterOptions(workspaceId)
  const commands = useRunCommands(workspaceId)

  const stop = async (target: RunCommandsTarget, workflowId: string) => {
    try {
      await commands.stop(workflowId, target.executionId)
      toast.success('Run stopped')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to stop run'))
    }
  }
  const retry = async (target: RunCommandsTarget, workflowId: string) => {
    try {
      await commands.retry(workflowId, target.executionId)
      toast.success('Retry started')
    } catch {
      toast.error('Failed to retry execution')
    }
  }
  const openWorkflow = (workflowId: string) =>
    window.open(
      workspacePath(workspaceId, `workflows/${encodeURIComponent(workflowId)}`),
      '_blank',
      'noopener,noreferrer'
    )
  const openSnapshot = (executionId: string) =>
    router.push(
      serializeRunList(
        platformHref(
          workspacePath(workspaceId, `workflows/runs/${encodeURIComponent(executionId)}`),
          search
        ),
        view
      )
    )

  function rowActions(run: RunSummary): RunRowActions {
    const target = live.commands.get(run.id)
    if (!target) return { commands: [], links: [] }
    const { workflowId, openWorkflowId } = target
    const stopping = target.stopping || commands.stopping(target.executionId)
    return {
      commands: [
        ...(target.retryable && workflowId
          ? [
              {
                id: 'retry',
                label: commands.retrying ? 'Retrying…' : 'Retry',
                icon: 'I055' as const,
                disabled: commands.retrying,
                onSelect: () => void retry(target, workflowId),
              },
            ]
          : []),
        ...(target.stoppable && workflowId && commands.canStop
          ? [
              {
                id: 'stop',
                label: stopping ? 'Stopping…' : 'Stop run',
                icon: 'I035' as const,
                disabled: stopping,
                onSelect: () => void stop(target, workflowId),
              },
            ]
          : []),
      ],
      links: [
        {
          id: 'open-workflow',
          label: 'Open workflow',
          icon: 'I037',
          disabled: !openWorkflowId,
          onSelect: () => {
            if (openWorkflowId) openWorkflow(openWorkflowId)
          },
        },
        {
          id: 'open-snapshot',
          label: 'Open snapshot',
          icon: 'eye',
          disabled: !target.snapshot,
          onSelect: () => openSnapshot(target.executionId),
        },
      ],
    }
  }

  return (
    <RunList
      read={view.view === 'dashboard' ? dashboard.read : live.read}
      workspace={{ id: workspaceId, live: true }}
      referenceTime={Date.now()}
      runs={live.runs}
      triggers={[...RUN_TRIGGER_OPTIONS, ...integrationTriggers]}
      workflows={options.workflows}
      folders={options.folders}
      more={live.more}
      rowActions={rowActions}
      exportAction={{
        href: runExportHref(workspaceId, view),
        disabled:
          !commands.canExport ||
          (view.view === 'dashboard' ? !dashboard.totals?.runs : live.runs.length === 0),
      }}
      dashboard={
        dashboard.totals ? (
          <RunDashboard
            totals={dashboard.totals}
            runs={dashboard.runs}
            errors={dashboard.errors}
            latency={dashboard.latency}
            workflows={dashboard.workflows}
          />
        ) : null
      }
    />
  )
}
