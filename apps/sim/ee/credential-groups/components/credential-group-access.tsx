'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { Plus, ShieldCheck } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { CredentialGroupAccessGrant } from '@/lib/api/contracts/credential-groups'
import type { ResourcePolicySubject } from '@/lib/resource-policies/types'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  usePermissionGroups,
  useUserPermissionConfig,
} from '@/ee/access-control/hooks/permission-groups'
import {
  useCredentialGroupAccess,
  useUpdateCredentialGroupAccess,
} from '@/hooks/queries/credential-groups'
import { useWorkflows } from '@/hooks/queries/workflows'

interface CredentialGroupAccessProps {
  workspaceId: string
  groupId: string
}

type ManagedSubjectType = 'workflow' | 'access_control_group' | 'workspace_role'

const SUBJECT_TYPE_OPTIONS = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'access_control_group', label: 'Access Control Group' },
  { value: 'workspace_role', label: 'Workspace role' },
] as const

const WORKSPACE_ROLE_OPTIONS = [
  { value: 'read', label: 'Readers and above' },
  { value: 'write', label: 'Writers and admins' },
  { value: 'admin', label: 'Admins only' },
] as const

function subjectKey(subject: ResourcePolicySubject): string {
  return JSON.stringify(subject)
}

export function CredentialGroupAccess({ workspaceId, groupId }: CredentialGroupAccessProps) {
  const access = useCredentialGroupAccess(workspaceId, groupId)
  const updateAccess = useUpdateCredentialGroupAccess()
  const workflows = useWorkflows(workspaceId)
  const permissionConfig = useUserPermissionConfig(workspaceId)
  const permissionGroups = usePermissionGroups(permissionConfig.data?.organizationId ?? undefined)
  const [showAdd, setShowAdd] = useState(false)
  const [subjectType, setSubjectType] = useState<ManagedSubjectType>('workflow')
  const [targetId, setTargetId] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  const policy = access.data
  const applicablePermissionGroups = (permissionGroups.data ?? []).filter(
    (group) => group.isDefault || group.workspaces.some((workspace) => workspace.id === workspaceId)
  )
  const targetOptions =
    subjectType === 'workflow'
      ? (workflows.data ?? []).map((workflow) => ({
          value: workflow.id,
          label: `${workflow.name}${workflow.isDeployed ? '' : ' (not deployed)'}`,
        }))
      : subjectType === 'access_control_group'
        ? applicablePermissionGroups.map((group) => ({ value: group.id, label: group.name }))
        : [...WORKSPACE_ROLE_OPTIONS]
  const targetOptionsPending =
    subjectType === 'workflow'
      ? workflows.isPending
      : subjectType === 'access_control_group'
        ? permissionConfig.isPending || permissionGroups.isPending
        : false
  const targetPlaceholder = targetOptionsPending
    ? `Loading ${subjectType === 'workflow' ? 'workflows' : 'access control groups'}...`
    : targetOptions.length === 0
      ? `No ${subjectType === 'workflow' ? 'workflows' : 'access control groups'} available`
      : 'Select one'

  const labelForSubject = (subject: ResourcePolicySubject): string => {
    switch (subject.type) {
      case 'workflow':
        return (
          workflows.data?.find((workflow) => workflow.id === subject.workflowId)?.name ??
          subject.workflowId
        )
      case 'access_control_group':
        return (
          permissionGroups.data?.find((group) => group.id === subject.accessControlGroupId)?.name ??
          subject.accessControlGroupId
        )
      case 'workspace_role':
        return (
          WORKSPACE_ROLE_OPTIONS.find((role) => role.value === subject.minimumRole)?.label ??
          subject.minimumRole
        )
      case 'user':
        return `User ${subject.userId}`
      case 'external_identity':
        return `${subject.provider} user ${subject.subjectId}`
    }
  }

  const descriptionForSubject = (subject: ResourcePolicySubject): string => {
    if (subject.type === 'workflow') return 'Use all credentials in deployed runs'
    return 'Use all credentials in this group'
  }

  const saveGrants = async (
    grants: Array<{ id?: string; subject: ResourcePolicySubject }>
  ): Promise<boolean> => {
    if (!policy) return false
    try {
      await updateAccess.mutateAsync({
        workspaceId,
        groupId,
        body: { expectedRevision: policy.revision, grants },
      })
      return true
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update access'))
      return false
    }
  }

  const handleAdd = async () => {
    if (!targetId || !policy) return
    let subject: ResourcePolicySubject
    if (subjectType === 'workflow') {
      subject = { type: 'workflow', workflowId: targetId }
    } else if (subjectType === 'access_control_group') {
      subject = { type: 'access_control_group', accessControlGroupId: targetId }
    } else {
      subject = {
        type: 'workspace_role',
        minimumRole: targetId as 'read' | 'write' | 'admin',
      }
    }
    if (policy.grants.some((grant) => subjectKey(grant.subject) === subjectKey(subject))) {
      setModalError('This subject already has access')
      return
    }
    if (
      await saveGrants([
        ...policy.grants.map((grant) => ({ id: grant.id, subject: grant.subject })),
        { subject },
      ])
    ) {
      setShowAdd(false)
      setTargetId('')
      setModalError(null)
      toast.success('Access added')
    }
  }

  const handleRemove = async (grantId: string) => {
    if (!policy) return
    const next = policy.grants
      .filter((grant) => grant.id !== grantId)
      .map((grant) => ({ id: grant.id, subject: grant.subject }))
    if (await saveGrants(next)) toast.success('Access removed')
  }

  if (access.error) {
    return (
      <SettingsEmptyState tone='error'>
        {getErrorMessage(access.error, "Couldn't load access")}
      </SettingsEmptyState>
    )
  }
  if (access.isPending || !policy) return null

  return (
    <>
      <SettingsSection
        label='Additional access'
        action={
          <Chip leftIcon={Plus} onClick={() => setShowAdd(true)}>
            Add access
          </Chip>
        }
      >
        {policy.grants.length === 0 ? (
          <SettingsEmptyState variant='inline'>No additional access grants</SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {policy.grants.map((grant: CredentialGroupAccessGrant) => (
              <SettingsResourceRow
                key={grant.id}
                icon={<ShieldCheck className='text-[var(--text-icon)]' aria-hidden />}
                iconFilled
                title={labelForSubject(grant.subject)}
                description={descriptionForSubject(grant.subject)}
                trailing={
                  <RowActionsMenu
                    label={`${labelForSubject(grant.subject)} access actions`}
                    actions={[
                      {
                        label: 'Remove',
                        destructive: true,
                        onSelect: () => void handleRemove(grant.id),
                        disabled: updateAccess.isPending,
                      },
                    ]}
                  />
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <ChipModal
        open={showAdd}
        onOpenChange={(open) => {
          setShowAdd(open)
          if (!open) {
            setTargetId('')
            setModalError(null)
          }
        }}
        dismissDisabled={updateAccess.isPending}
        size='sm'
        srTitle='Add Credential Group access'
      >
        <ChipModalHeader onClose={() => setShowAdd(false)}>Add access</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='dropdown'
            title='Subject type'
            value={subjectType}
            onChange={(value) => {
              setSubjectType(value as ManagedSubjectType)
              setTargetId('')
              setModalError(null)
            }}
            options={SUBJECT_TYPE_OPTIONS}
          />
          <ChipModalField
            type='dropdown'
            title={subjectType === 'workspace_role' ? 'Minimum role' : 'Subject'}
            value={targetId}
            onChange={(value) => {
              setTargetId(value)
              setModalError(null)
            }}
            options={targetOptions}
            placeholder={targetPlaceholder}
            disabled={targetOptionsPending || targetOptions.length === 0}
          />
          <ChipModalError>{modalError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setShowAdd(false)}
          cancelDisabled={updateAccess.isPending}
          primaryAction={{
            label: updateAccess.isPending ? 'Adding...' : 'Add access',
            onClick: () => void handleAdd(),
            disabled: !targetId || updateAccess.isPending,
          }}
        />
      </ChipModal>
    </>
  )
}
