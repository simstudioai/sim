'use client'

import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FieldStack, Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { MetadataFields } from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
import type { CustomBlock } from '@/platform/lib/data/custom-blocks'

interface SourceOption {
  id: string
  name: string
}

interface BlockSourceProps {
  /** The published block, whose source is fixed; `null` while publishing a new one. */
  existing: CustomBlock | null
  notDeployed: boolean
  workspaces: readonly SourceOption[]
  workspaceId: string
  onWorkspaceChange: (workspaceId: string) => void
  workflows: readonly SourceOption[]
  workflowId: string
  onWorkflowChange: (workflowId: string) => void
}

/** The deployed workflow a block runs: picked while publishing, read-only once published. */
export function BlockSource({
  existing,
  notDeployed,
  workspaces,
  workspaceId,
  onWorkspaceChange,
  workflows,
  workflowId,
  onWorkflowChange,
}: BlockSourceProps) {
  return (
    <SettingsSection title='Source'>
      <FieldStack>
        {existing ? (
          <>
            <MetadataFields
              label='Source workflow'
              fields={[
                { id: 'workspace', label: 'Workspace', value: existing.workspaceName ?? '—' },
                { id: 'workflow', label: 'Workflow', value: existing.workflowName },
              ]}
            />
            <Muted>
              {notDeployed
                ? 'This workflow isn’t deployed. Redeploy it so the block can run'
                : 'The source workflow can’t be changed'}
            </Muted>
          </>
        ) : (
          <>
            <SearchableSelect
              label='Workspace'
              options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
              value={workspaceId}
              onValueChange={(next) => {
                if (next) onWorkspaceChange(next)
              }}
              placeholder='Select a workspace'
              searchLabel='Search workspaces'
            />
            <SearchableSelect
              label='Workflow'
              options={workflows.map((w) => ({ value: w.id, label: w.name }))}
              value={workflowId || null}
              onValueChange={(next) => onWorkflowChange(next ?? '')}
              placeholder='Select a deployed workflow'
              searchLabel='Search workflows'
              error={
                notDeployed
                  ? 'This workflow isn’t deployed. Deploy it first, then publish it as a block'
                  : undefined
              }
              disabled={workflows.length === 0}
              disabledReason={workflows.length === 0 ? 'No workflows in this workspace' : undefined}
            />
          </>
        )}
      </FieldStack>
    </SettingsSection>
  )
}
