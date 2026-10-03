'use client'

import { ChipSwitch, Label, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useUpdateForkSyncDefault } from '@/ee/workspace-forking/hooks/workspace-fork'

/** Both outcomes named, so "off" does not have to be inferred from the label. */
const FORK_SYNC_DEFAULT_OPTIONS = [
  { value: 'sync', label: 'Sync' },
  { value: 'exclude', label: "Don't sync" },
] as const

interface ForkSyncDefaultToggleProps {
  workspaceId: string
  /** The lineage's stored policy: true means new workflows start outside fork sync. */
  excludeNewWorkflows: boolean
}

/**
 * Whether a newly created workflow in this lineage joins fork sync automatically.
 *
 * Positive polarity, matching the checkbox list below it; this component owns the inversion
 * from the stored `forkSyncNewWorkflowsExcluded`. The write reaches every workspace in the
 * lineage and is forward-only: no existing workflow moves.
 */
export function ForkSyncDefaultToggle({
  workspaceId,
  excludeNewWorkflows,
}: ForkSyncDefaultToggleProps) {
  const updateDefault = useUpdateForkSyncDefault()

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-col gap-1'>
        {/* No `htmlFor`: `ChipSwitch` is a radio group that takes no id; it carries its own `aria-label`. */}
        <Label>Sync new workflows by default</Label>
        <p className='text-[var(--text-muted)] text-caption'>
          Applies to every workspace in this fork lineage.
        </p>
      </div>
      <ChipSwitch
        aria-label='Sync new workflows by default'
        options={FORK_SYNC_DEFAULT_OPTIONS}
        value={excludeNewWorkflows ? 'exclude' : 'sync'}
        disabled={updateDefault.isPending}
        onChange={(value) =>
          updateDefault.mutate(
            { workspaceId, body: { excludeNewWorkflows: value === 'exclude' } },
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
