'use client'

import { Label, Switch, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useUpdateForkSyncDefault } from '@/ee/workspace-forking/hooks/workspace-fork'

interface ForkSyncDefaultToggleProps {
  workspaceId: string
  /** The lineage's stored policy: true means new workflows start outside fork sync. */
  excludeNewWorkflows: boolean
  /**
   * True while the value on screen is not this workspace's own. Covers the first load AND
   * the placeholder window after a workspace switch: `useForkLineage` sets
   * `placeholderData: keepPreviousData`, so it serves the PREVIOUS workspace's policy with
   * `isLoading: false`. Rendering then would show one workspace's value under another's
   * name, and a click would write that stale value to the newly selected lineage.
   */
  loading: boolean
}

/**
 * Whether a newly created workflow in this lineage joins fork sync automatically.
 *
 * Positive polarity, matching the checkbox list below it - on means new workflows sync,
 * which is the historical default. The stored column is the negative
 * `forkSyncNewWorkflowsExcluded`, so this component owns that inversion.
 *
 * The description is not decoration: this writes to every workspace in the lineage, and
 * without it the control reads as a local preference. That is the "prevents a
 * misunderstanding" case `sim-ui-copy.md` reserves supporting copy for.
 *
 * Forward-only - no existing workflow's checkbox moves, so flipping it can never silently
 * pull a workflow into or out of sync.
 */
export function ForkSyncDefaultToggle({
  workspaceId,
  excludeNewWorkflows,
  loading,
}: ForkSyncDefaultToggleProps) {
  const updateDefault = useUpdateForkSyncDefault()

  // Render nothing until the lineage resolves, matching the workflow list below. A
  // placeholder would have to guess a value, and guessing `false` renders the switch ON -
  // the opposite of the truth for an opt-in lineage, which then visibly snaps once the
  // real value lands. Disabled-but-wrong is worse than absent for a cross-workspace policy.
  if (loading) return null

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-col gap-1'>
        <Label htmlFor='fork-sync-new-workflows'>Sync new workflows by default</Label>
        <p className='text-[var(--text-muted)] text-caption'>
          Applies to every workspace in this fork lineage.
        </p>
      </div>
      <Switch
        id='fork-sync-new-workflows'
        checked={!excludeNewWorkflows}
        disabled={updateDefault.isPending}
        onCheckedChange={(syncNewWorkflows) =>
          updateDefault.mutate(
            { workspaceId, body: { excludeNewWorkflows: !syncNewWorkflows } },
            {
              onError: (error) =>
                toast.error(getErrorMessage(error, 'Failed to update the fork sync default')),
            }
          )
        }
      />
    </div>
  )
}
