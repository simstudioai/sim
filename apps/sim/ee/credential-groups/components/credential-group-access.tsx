'use client'

import { useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { Workflow } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { CredentialGroupAccessResponse } from '@/lib/api/contracts/credential-groups'
import { CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT } from '@/lib/credential-groups/limits'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { CredentialGroupAddResourceModal } from '@/ee/credential-groups/components/credential-group-add-resource-modal'
import {
  useCredentialGroupAccess,
  useUpdateCredentialGroupAccess,
} from '@/hooks/queries/credential-groups'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface AccessDraft {
  allowedWorkflowIds: string[]
  baseline: string
  expectedRevision: number
  groupId: string
}

interface UseCredentialGroupAccessEditorProps {
  workspaceId: string
  groupId: string
  enabled: boolean
}

function normalizeAllowedWorkflowIds(workflowIds: readonly string[]): string[] {
  for (const workflowId of workflowIds) {
    if (!workflowId || workflowId !== workflowId.trim()) {
      throw new Error('Credential Group workflow access requires canonical non-empty workflow IDs')
    }
  }
  if (new Set(workflowIds).size !== workflowIds.length) {
    throw new Error('Credential Group workflow access contains duplicate workflows')
  }
  if (workflowIds.length > CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT) {
    throw new Error(
      `Credential Group workflow access cannot exceed ${CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT} workflows`
    )
  }
  return [...workflowIds].sort()
}

function serializeAllowedWorkflowIds(workflowIds: readonly string[]): string {
  return JSON.stringify(normalizeAllowedWorkflowIds(workflowIds))
}

export function useCredentialGroupAccessEditor({
  workspaceId,
  groupId,
  enabled,
}: UseCredentialGroupAccessEditorProps) {
  const access = useCredentialGroupAccess(workspaceId, groupId, { enabled })
  const updateAccess = useUpdateCredentialGroupAccess()
  const setSettingsNavigationBlocked = useSettingsDirtyStore((state) => state.setNavigationBlocked)
  const [draft, setDraft] = useState<AccessDraft | null>(null)

  if (draft && draft.groupId !== groupId) {
    throw new Error('Credential Group access draft cannot move between resources')
  }

  const persistedAllowedWorkflowIds = access.data
    ? normalizeAllowedWorkflowIds(access.data.allowedWorkflowIds)
    : null
  const persistedValue = persistedAllowedWorkflowIds
    ? serializeAllowedWorkflowIds(persistedAllowedWorkflowIds)
    : ''
  const allowedWorkflowIds = draft?.allowedWorkflowIds ?? persistedAllowedWorkflowIds
  const revision = draft?.expectedRevision ?? access.data?.revision ?? null
  const dirty = draft !== null
  const workflowIds = new Set(access.data?.workflows.map((workflow) => workflow.id) ?? [])
  const selectionsAvailable = Boolean(
    allowedWorkflowIds?.every((workflowId) => workflowIds.has(workflowId))
  )

  const setAllowedWorkflowIds = (nextWorkflowIds: readonly string[], expectedRevision: number) => {
    if (!access.data) throw new Error('Credential Group workflow access is unavailable')
    const currentRevision = draft?.expectedRevision ?? access.data.revision
    if (expectedRevision !== currentRevision) {
      throw new Error('Credential Group workflow access changed while it was being edited')
    }
    const normalizedWorkflowIds = normalizeAllowedWorkflowIds(nextWorkflowIds)
    const nextValue = serializeAllowedWorkflowIds(normalizedWorkflowIds)
    updateAccess.reset()
    setDraft((current) => {
      const baseline = current?.baseline ?? persistedValue
      if (nextValue === baseline) return null
      return {
        allowedWorkflowIds: normalizedWorkflowIds,
        baseline,
        expectedRevision: current?.expectedRevision ?? access.data.revision,
        groupId,
      }
    })
  }

  const discard = () => {
    setDraft(null)
    updateAccess.reset()
  }

  const save = async () => {
    if (!draft) return
    setSettingsNavigationBlocked(true)
    try {
      const availableWorkflowIds = new Set(access.data?.workflows.map((workflow) => workflow.id))
      if (draft.allowedWorkflowIds.some((workflowId) => !availableWorkflowIds.has(workflowId))) {
        throw new Error('Remove unavailable workflows before saving access')
      }
      await updateAccess.mutateAsync({
        workspaceId,
        groupId,
        body: {
          expectedRevision: draft.expectedRevision,
          allowedWorkflowIds: draft.allowedWorkflowIds,
        },
      })
      setDraft(null)
      toast.success('Workflow access saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update workflow access'))
    } finally {
      setSettingsNavigationBlocked(false)
    }
  }

  return {
    allowedWorkflowIds,
    revision,
    workflows: access.data?.workflows ?? null,
    setAllowedWorkflowIds,
    discard,
    save,
    dirty,
    error: updateAccess.error
      ? getErrorMessage(updateAccess.error, 'Could not update workflow access')
      : null,
    isPending: access.isPending && !access.data,
    loadError: access.data ? null : access.error,
    isReady: Boolean(access.data && selectionsAvailable),
    saving: updateAccess.isPending,
  }
}

interface CredentialGroupAccessProps {
  allowedWorkflowIds: readonly string[] | null
  revision: number | null
  workflows: CredentialGroupAccessResponse['workflows'] | null
  onAllowedWorkflowIdsChange: (workflowIds: readonly string[], expectedRevision: number) => void
  error: string | null
  isPending: boolean
  loadError: unknown
  saving: boolean
}

export function CredentialGroupAccess({
  allowedWorkflowIds,
  revision,
  workflows,
  onAllowedWorkflowIdsChange,
  error,
  isPending,
  loadError,
  saving,
}: CredentialGroupAccessProps) {
  const [showAddWorkflow, setShowAddWorkflow] = useState(false)

  if (loadError) {
    return (
      <SettingsEmptyState tone='error'>
        {getErrorMessage(loadError, "Couldn't load workflow access")}
      </SettingsEmptyState>
    )
  }
  if (isPending) return null
  if (!workflows) throw new Error('Credential Group workflow catalog is unavailable')
  if (!allowedWorkflowIds) throw new Error('Credential Group workflow access is unavailable')
  if (revision === null) throw new Error('Credential Group access revision is unavailable')

  const allowedWorkflowIdSet = new Set(allowedWorkflowIds)
  if (allowedWorkflowIdSet.size !== allowedWorkflowIds.length) {
    throw new Error('Credential Group workflow access contains duplicate workflows')
  }
  const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  for (const workflowId of allowedWorkflowIds) {
    if (!workflowsById.has(workflowId)) {
      throw new Error(
        `Credential Group workflow access references unavailable workflow ${workflowId}`
      )
    }
  }
  const allowedWorkflows = workflows.filter((workflow) => allowedWorkflowIdSet.has(workflow.id))
  const availableWorkflows = workflows.filter((workflow) => !allowedWorkflowIdSet.has(workflow.id))

  const addWorkflow = (workflowId: string) => {
    if (!workflowsById.has(workflowId)) throw new Error(`Workflow ${workflowId} is unavailable`)
    if (allowedWorkflowIdSet.has(workflowId)) {
      throw new Error(`Workflow ${workflowId} already has Credential Group access`)
    }
    onAllowedWorkflowIdsChange([...allowedWorkflowIds, workflowId], revision)
  }

  const removeWorkflow = (workflowId: string) => {
    if (!allowedWorkflowIdSet.has(workflowId)) {
      throw new Error(`Workflow ${workflowId} does not have Credential Group access`)
    }
    onAllowedWorkflowIdsChange(
      allowedWorkflowIds.filter((allowedWorkflowId) => allowedWorkflowId !== workflowId),
      revision
    )
  }

  const sectionAction = (
    <Chip
      onClick={() => setShowAddWorkflow(true)}
      disabled={
        saving ||
        availableWorkflows.length === 0 ||
        allowedWorkflowIds.length >= CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT
      }
    >
      Add workflow
    </Chip>
  )

  return (
    <>
      <SettingsSection label='Workflow access' action={sectionAction}>
        {error && (
          <p role='alert' className='mb-3 px-0.5 text-[var(--text-error)] text-caption'>
            {error}
          </p>
        )}

        {allowedWorkflows.length === 0 ? (
          <SettingsEmptyState variant='inline'>No workflows have access</SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {allowedWorkflows.map((workflow) => (
              <SettingsResourceRow
                key={workflow.id}
                icon={<Workflow className='text-[var(--text-icon)]' aria-hidden />}
                iconFilled
                title={workflow.name}
                description='Deployed runs can use every credential in this group'
                disabled={saving}
                trailing={
                  saving ? undefined : (
                    <RowActionsMenu
                      label={`${workflow.name} actions`}
                      actions={[
                        {
                          label: 'Remove',
                          destructive: true,
                          onSelect: () => removeWorkflow(workflow.id),
                        },
                      ]}
                    />
                  )
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {showAddWorkflow && (
        <CredentialGroupAddResourceModal
          resourceType='workflow'
          resources={availableWorkflows}
          disabled={saving}
          onAdd={(id) => {
            addWorkflow(id)
            setShowAddWorkflow(false)
          }}
          onClose={() => setShowAddWorkflow(false)}
        />
      )}
    </>
  )
}
