'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { toError } from '@sim/utils/errors'
import { normalizeRuleStages } from '@/lib/guardrails/pii-entities'
import {
  type DataRetentionResponse,
  useOrganizationRetention,
  useUpdateOrganizationRetention,
} from '@/ee/data-retention/hooks/data-retention'
import {
  buildRetentionUpdate,
  type EditingPolicy,
  hoursToDisplayDays,
  newOverrideDraft,
  normalizePolicyDraft,
  orgPolicyDraft,
  orgPolicySummary,
  overrideDraft,
  overridePolicySummary,
  overrideWorkspaceIds,
  type PolicyDraft,
  type RetentionSnapshot,
  withOrgPolicy,
  withOverridePolicy,
  withoutOverride,
} from '@/ee/data-retention/lib/policy-draft'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import {
  LoadingState,
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { PolicyDetail } from '@/platform/app/(shell)/settings/_components/sections/data-retention/policy-detail'
import { ActivityRow, Button, EmptyState, FailureNotice } from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

function snapshotFrom(data: DataRetentionResponse): RetentionSnapshot {
  const rules = data.configured.piiRedaction?.rules ?? []
  const defaultRule = rules.find((rule) => rule.workspaceId === null)
  return {
    logDays: hoursToDisplayDays(data.effective.logRetentionHours),
    softDeleteDays: hoursToDisplayDays(data.effective.softDeleteRetentionHours),
    taskCleanupDays: hoursToDisplayDays(data.effective.taskCleanupHours),
    defaultPii: defaultRule
      ? { id: defaultRule.id, stages: normalizeRuleStages(defaultRule) }
      : null,
    piiOverrides: rules
      .filter((rule) => rule.workspaceId !== null)
      .map((rule) => ({
        id: rule.id,
        workspaceId: rule.workspaceId as string,
        stages: normalizeRuleStages(rule),
      })),
    overrides: data.configured.retentionOverrides ?? [],
  }
}

interface RetentionFormProps {
  initialData: DataRetentionResponse
  organizationId: string
  workspaceOptions: { value: string; label: string }[]
}

/** The whole document is one save: the route replaces each key, so all of it is always sent. */
function RetentionForm({ initialData, organizationId, workspaceOptions }: RetentionFormProps) {
  const update = useUpdateOrganizationRetention()
  const [snapshot, setSnapshot] = useState(() => snapshotFrom(initialData))
  const [editing, setEditing] = useState<EditingPolicy | null>(null)
  const changed =
    editing !== null &&
    normalizePolicyDraft(editing.draft) !== normalizePolicyDraft(editing.original)
  const discard = () => {
    if (editing) setEditing({ ...editing, draft: editing.original })
  }
  const guard = useSettingsUnsavedGuard({
    isDirty: changed,
    navigationBlocked: update.isPending,
    onDiscard: discard,
  })
  const workspaceName = (id: string) =>
    workspaceOptions.find((option) => option.value === id)?.label ?? 'Unknown workspace'
  const withOverrides = overrideWorkspaceIds(snapshot).sort((a, b) =>
    workspaceName(a).localeCompare(workspaceName(b))
  )
  const taken = new Set(withOverrides)
  const freeWorkspaces = workspaceOptions.filter((option) => !taken.has(option.value))

  /** Excludes workspaces held by OTHER overrides. */
  function pickerOptions(original: PolicyDraft) {
    const others = new Set(withOverrides.filter((id) => !original.workspaceIds.includes(id)))
    return workspaceOptions.filter((option) => !others.has(option.value))
  }

  function open(draft: PolicyDraft, isNew = false) {
    setEditing({ draft, original: draft, isNew })
  }

  async function persist(next: RetentionSnapshot) {
    await update.mutateAsync({ orgId: organizationId, settings: buildRetentionUpdate(next) })
    setSnapshot(next)
    setEditing(null)
  }

  async function save() {
    if (!editing || update.isPending) return
    const { draft } = editing
    try {
      if (draft.isOrgDefault) {
        await persist(withOrgPolicy(snapshot, draft))
        toast.success('Organization defaults saved.')
        return
      }
      if (draft.workspaceIds.length === 0) return
      await persist(withOverridePolicy(snapshot, editing))
      toast.success('Workspace override saved.')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  if (editing) {
    return (
      <SectionStack>
        <PolicyDetail
          draft={editing.draft}
          isNew={editing.isNew}
          changed={changed}
          isSaving={update.isPending}
          canRemove={!editing.draft.isOrgDefault && !editing.isNew}
          workspaceOptions={pickerOptions(editing.original)}
          onChange={(draft) => {
            if (!update.isPending) setEditing({ ...editing, draft })
          }}
          onBack={() => guard.guardBack(() => setEditing(null))}
          onDiscard={discard}
          onSave={() => void save()}
          onRemove={async () => {
            await persist(withoutOverride(snapshot, editing.original.workspaceIds))
            toast.success('Workspace override removed.')
          }}
        />
      </SectionStack>
    )
  }

  return (
    <SectionStack>
      <SectionToolbar>
        <Button
          variant='primary'
          size='compact'
          icon='I074'
          disabled={freeWorkspaces.length === 0}
          onClick={() => open(newOverrideDraft(), true)}
        >
          Add override
        </Button>
      </SectionToolbar>
      <SettingsSection title='Retention policies'>
        <ResourceList>
          <ActivityRow
            title='Organization'
            detail={orgPolicySummary(snapshot)}
            metadata='Default'
            onOpen={() => open(orgPolicyDraft(snapshot))}
          />
          {withOverrides.map((workspaceId) => (
            <ActivityRow
              key={workspaceId}
              title={workspaceName(workspaceId)}
              detail={overridePolicySummary(snapshot, workspaceId)}
              onOpen={() => open(overrideDraft(snapshot, workspaceId))}
            />
          ))}
        </ResourceList>
      </SettingsSection>
    </SectionStack>
  )
}

export default function DataRetentionSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const { data, isLoading, isFetching, refetch } = useOrganizationRetention(organizationId)
  const workspacesQuery = useWorkspacesQuery(Boolean(organizationId))

  if (isLoading || workspacesQuery.isPending)
    return <LoadingState label='Loading data retention…' />
  if (!data) {
    return (
      <FailureNotice
        message='Failed to load data retention settings.'
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )
  }
  if (organization.deployment.billingEnabled && !data.isEnterprise) {
    return <EmptyState title='Data retention is available on Enterprise plans only.' />
  }
  return (
    <>
      {!workspacesQuery.data && (
        <FailureNotice
          message='Failed to load workspaces, so overrides cannot be added right now.'
          retrying={workspacesQuery.isFetching}
          onRetry={() => void workspacesQuery.refetch()}
        />
      )}
      <RetentionForm
        key={organizationId}
        initialData={data}
        organizationId={organizationId}
        workspaceOptions={(workspacesQuery.data ?? [])
          .filter((workspace) => workspace.organizationId === organizationId)
          .map((workspace) => ({ value: workspace.id, label: workspace.name }))}
      />
    </>
  )
}
