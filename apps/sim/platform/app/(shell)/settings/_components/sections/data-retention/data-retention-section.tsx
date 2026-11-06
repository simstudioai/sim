'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { toError } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import {
  DraftConflictNotice,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { useServerDraft } from '@/platform/app/(shell)/settings/_components/section-parts/use-server-draft'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { PolicyDetail } from '@/platform/app/(shell)/settings/_components/sections/data-retention/policy-detail'
import {
  ActivityRow,
  Button,
  EmptyState,
  FailureNotice,
  LoadingRows,
  RowList,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  buildRetentionUpdate,
  type DataRetentionResponse,
  hoursToDisplayDays,
  newOverrideDraft,
  normalizePolicyDraft,
  normalizeRuleStages,
  orgPolicyDraft,
  orgPolicySummary,
  overrideDraft,
  overridePolicySummary,
  overrideWorkspaceIds,
  type PolicyDraft,
  type RetentionSnapshot,
  useOrganizationRetention,
  useUpdateOrganizationRetention,
  useWorkspacesQuery,
  withOrgPolicy,
  withOverridePolicy,
  withoutOverride,
} from '@/platform/lib/data/data-retention'
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

const sameSnapshot = (left: RetentionSnapshot, right: RetentionSnapshot) =>
  JSON.stringify(buildComparable(left)) === JSON.stringify(buildComparable(right))

/** Rule ids and array order carry no meaning here, and the order differs across a save. */
function buildComparable(snapshot: RetentionSnapshot) {
  const byWorkspace = (left: { workspaceId: string }, right: { workspaceId: string }) =>
    compareStrings(left.workspaceId, right.workspaceId)
  return {
    ...snapshot,
    defaultPii: snapshot.defaultPii?.stages ?? null,
    piiOverrides: [...snapshot.piiOverrides]
      .sort(byWorkspace)
      .map(({ workspaceId, stages }) => ({ workspaceId, stages })),
    overrides: [...snapshot.overrides].sort(byWorkspace),
  }
}

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
      return samePolicy(policyDraftOf(latest, selection), policy.baseline) ? latest : null
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
        await persist(
          withOverridePolicy(latest, { draft, original: baseline, isNew: selection.kind === 'new' })
        )
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
  refetch: () => Promise<{ data?: DataRetentionResponse }>
}

/** The whole document is one save: the route replaces each key, so all of it is always sent. */
function RetentionForm({
  initialData,
  organizationId,
  workspaceOptions,
  refetch,
}: RetentionFormProps) {
  const update = useUpdateOrganizationRetention()
  const retention = useServerDraft({
    server: snapshotFrom(initialData),
    isEqual: sameSnapshot,
    saving: update.isPending,
  })
  const snapshot = retention.baseline
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
    retention.markSaved(next, next)
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
          const { data } = await refetch()
          return data ? snapshotFrom(data) : null
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
  const { data, isLoading, isFetching, refetch } = useOrganizationRetention(organizationId)
  const workspacesQuery = useWorkspacesQuery(Boolean(organizationId))

  if (isLoading || workspacesQuery.isPending) return <LoadingRows label='Loading data retention…' />
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
        refetch={refetch}
        workspaceOptions={(workspacesQuery.data ?? [])
          .filter((workspace) => workspace.organizationId === organizationId)
          .map((workspace) => ({ value: workspace.id, label: workspace.name }))}
      />
    </>
  )
}
