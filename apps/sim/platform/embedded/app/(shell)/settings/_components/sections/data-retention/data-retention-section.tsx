'use client'

import { useState } from 'react'
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
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  ActivityRow,
  Button,
  EmptyState,
  errorMessageOr,
  FailureNotice,
  LoadingRows,
  QueryBoundary,
  RowList,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  DraftConflictNotice,
  SectionStack,
  SectionToolbar,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useServerDraft } from '@/platform/embedded/app/(shell)/_components/use-server-draft'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { PolicyDetail } from '@/platform/embedded/app/(shell)/settings/_components/sections/data-retention/policy-detail'
import { toast } from '@/platform/shared/toast'

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

type PolicySelection =
  | { kind: 'organization' }
  | { kind: 'override'; workspaceId: string }
  | { kind: 'new' }

function policyDraftOf(snapshot: RetentionSnapshot, selection: PolicySelection): PolicyDraft {
  if (selection.kind === 'organization') return orgPolicyDraft(snapshot)
  if (selection.kind === 'override') return overrideDraft(snapshot, selection.workspaceId)
  return newOverrideDraft()
}

const samePolicy = (left: PolicyDraft, right: PolicyDraft) =>
  normalizePolicyDraft(left) === normalizePolicyDraft(right)

interface PolicyEditorProps {
  selection: PolicySelection
  snapshot: RetentionSnapshot
  workspaceOptions: { value: string; label: string }[]
  withOverrides: string[]
  isSaving: boolean
  /** Reads the document as it stands now; null when it cannot be confirmed. */
  readLatest: () => Promise<RetentionSnapshot | null>
  persist: (next: RetentionSnapshot) => Promise<void>
  onClose: () => void
}

/** One policy's edits. Only a change to this policy conflicts; the rest of the document is re-read at save. */
function PolicyEditor({
  selection,
  snapshot,
  workspaceOptions,
  withOverrides,
  isSaving,
  readLatest,
  persist,
  onClose,
}: PolicyEditorProps) {
  const [checking, setChecking] = useState(false)
  const saving = isSaving || checking
  const policy = useServerDraft({
    server: policyDraftOf(snapshot, selection),
    isEqual: samePolicy,
    saving,
  })
  const guard = useSettingsUnsavedGuard({
    isDirty: policy.dirty,
    navigationBlocked: saving,
    onDiscard: policy.takeLatest,
  })

  /** Excludes workspaces held by OTHER overrides. */
  const others = new Set(withOverrides.filter((id) => !policy.baseline.workspaceIds.includes(id)))

  /** The latest document with this policy still as the editor last saw it, or null to stop. */
  async function latestForWrite() {
    setChecking(true)
    try {
      const latest = await readLatest()
      if (!latest) {
        toast.error('Could not confirm the latest retention settings. Nothing was saved.')
        return null
      }
      if (!samePolicy(policyDraftOf(latest, selection), policy.baseline)) {
        toast.error('This policy changed while you were editing. Nothing was saved.')
        return null
      }
      return latest
    } finally {
      setChecking(false)
    }
  }

  async function save() {
    if (saving || policy.conflict) return
    const { draft, baseline } = policy
    if (!draft.isOrgDefault && draft.workspaceIds.length === 0) return
    try {
      const latest = await latestForWrite()
      if (!latest) return
      if (draft.isOrgDefault) {
        await persist(withOrgPolicy(latest, draft))
        toast.success('Organization defaults saved.')
      } else {
        const editing: EditingPolicy = {
          draft,
          original: baseline,
          isNew: selection.kind === 'new',
        }
        await persist(withOverridePolicy(latest, editing))
        toast.success('Workspace override saved.')
      }
      onClose()
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  return (
    <SectionStack>
      {policy.conflict && (
        <DraftConflictNotice onKeepMine={policy.keepMine} onTakeLatest={policy.takeLatest} />
      )}
      <PolicyDetail
        draft={policy.draft}
        isNew={selection.kind === 'new'}
        changed={policy.dirty}
        conflict={policy.conflict}
        isSaving={saving}
        canRemove={selection.kind === 'override'}
        workspaceOptions={workspaceOptions.filter((option) => !others.has(option.value))}
        onChange={(draft) => {
          if (!saving) policy.edit(() => draft)
        }}
        onBack={() => guard.guardBack(onClose)}
        onDiscard={policy.takeLatest}
        onSave={() => void save()}
        onRemove={async () => {
          const latest = await readLatest()
          if (!latest) throw new Error('Could not confirm the latest retention settings.')
          await persist(withoutOverride(latest, policy.baseline.workspaceIds))
          toast.success('Workspace override removed.')
          onClose()
        }}
      />
    </SectionStack>
  )
}

interface RetentionFormProps {
  initialData: DataRetentionResponse
  organizationId: string
  workspaceOptions: { value: string; label: string }[]
  refetch: () => Promise<{ data?: DataRetentionResponse; isError: boolean }>
}

/**
 * The whole document is one save: the route replaces each key, so all of it is always sent. It holds
 * no copy of the document: the query cache does, and a save writes the route's answer there.
 */
function RetentionForm({
  initialData,
  organizationId,
  workspaceOptions,
  refetch,
}: RetentionFormProps) {
  const update = useUpdateOrganizationRetention()
  const snapshot = snapshotFrom(initialData)
  const [selection, setSelection] = useState<PolicySelection | null>(null)
  const workspaceName = (id: string) =>
    workspaceOptions.find((option) => option.value === id)?.label ?? 'Unknown workspace'
  const withOverrides = overrideWorkspaceIds(snapshot).sort((a, b) =>
    workspaceName(a).localeCompare(workspaceName(b))
  )
  const taken = new Set(withOverrides)
  const freeWorkspaces = workspaceOptions.filter((option) => !taken.has(option.value))

  async function persist(next: RetentionSnapshot) {
    await update.mutateAsync({ orgId: organizationId, settings: buildRetentionUpdate(next) })
  }

  if (selection) {
    return (
      <PolicyEditor
        selection={selection}
        snapshot={snapshot}
        workspaceOptions={workspaceOptions}
        withOverrides={withOverrides}
        isSaving={update.isPending}
        readLatest={async () => {
          // A failed refetch still resolves, carrying the last good document.
          const { data, isError } = await refetch()
          return data && !isError ? snapshotFrom(data) : null
        }}
        persist={persist}
        onClose={() => setSelection(null)}
      />
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
          onClick={() => setSelection({ kind: 'new' })}
        >
          Add override
        </Button>
      </SectionToolbar>
      <SettingsSection title='Retention policies'>
        <RowList>
          <ActivityRow
            density='comfortable'
            title='Organization'
            detail={orgPolicySummary(snapshot)}
            metadata='Default'
            onOpen={() => setSelection({ kind: 'organization' })}
          />
          {withOverrides.map((workspaceId) => (
            <ActivityRow
              density='comfortable'
              key={workspaceId}
              title={workspaceName(workspaceId)}
              detail={overridePolicySummary(snapshot, workspaceId)}
              onOpen={() => setSelection({ kind: 'override', workspaceId })}
            />
          ))}
        </RowList>
      </SettingsSection>
    </SectionStack>
  )
}

export default function DataRetentionSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const retention = useOrganizationRetention(organizationId)
  const workspacesQuery = useWorkspacesQuery(Boolean(organizationId))

  if (workspacesQuery.isPending) return <LoadingRows label='Loading data retention…' />
  return (
    <QueryBoundary
      query={retention}
      failure={errorMessageOr('Failed to load data retention settings.')}
      loadingLabel='Loading data retention…'
      empty={(data) =>
        organization.deployment.billingEnabled &&
        !data.isEnterprise && (
          <EmptyState title='Data retention is available on Enterprise plans only.' />
        )
      }
    >
      {(data) => (
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
            refetch={retention.refetch}
            workspaceOptions={(workspacesQuery.data ?? [])
              .filter((workspace) => workspace.organizationId === organizationId)
              .map((workspace) => ({ value: workspace.id, label: workspace.name }))}
          />
        </>
      )}
    </QueryBoundary>
  )
}
