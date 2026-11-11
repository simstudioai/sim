'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { toError } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { PolicyDetail } from '@/app/(product)/o/[organizationId]/settings/_components/sections/data-retention/policy-detail'
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
  useOrganizationWorkspaces,
  useUpdateOrganizationRetention,
  withOrgPolicy,
  withOverridePolicy,
  withoutOverride,
} from '@/platform/lib/data/data-retention'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { compareText } from '@/platform/shared/time'

/** The sub-view id of the organization's own policy; any other id is an override's workspace. */
const ORGANIZATION_POLICY = 'organization'

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

interface WorkspaceOption {
  value: string
  label: string
}

/** The policies as one snapshot, the workspaces that name them, and who holds which override. */
function retentionModel(data: DataRetentionResponse, workspaces: { id: string; name: string }[]) {
  const snapshot = snapshotFrom(data)
  const workspaceOptions: WorkspaceOption[] = workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.name,
  }))
  const workspaceName = (id: string) =>
    workspaceOptions.find((option) => option.value === id)?.label ?? 'Unknown workspace'
  const withOverrides = overrideWorkspaceIds(snapshot).sort((a, b) =>
    compareText(workspaceName(a), workspaceName(b))
  )
  return { snapshot, workspaceOptions, workspaceName, withOverrides }
}

interface PolicyEditorProps {
  name: string
  organizationId: string
  snapshot: RetentionSnapshot
  original: PolicyDraft
  isNew: boolean
  workspaceOptions: WorkspaceOption[]
  onClose: () => void
  onSaved: (workspaceId: string) => void
}

/**
 * One policy's detail, edited in place. The whole document is one save: the route replaces each
 * key, so all of it is always sent. The draft is held only once edited, so a save that lands shows
 * the server's policy.
 */
function PolicyEditor({
  name,
  organizationId,
  snapshot,
  original,
  isNew,
  workspaceOptions,
  onClose,
  onSaved,
}: PolicyEditorProps) {
  const update = useUpdateOrganizationRetention()
  const [edited, setEdited] = useState<PolicyDraft | null>(null)
  const draft = edited ?? original
  const dirty = edited !== null && normalizePolicyDraft(edited) !== normalizePolicyDraft(original)

  async function persist(next: RetentionSnapshot) {
    await update.mutateAsync({ orgId: organizationId, settings: buildRetentionUpdate(next) })
  }

  async function save() {
    if (update.isPending) return
    if (!draft.isOrgDefault && draft.workspaceIds.length === 0) return
    try {
      if (draft.isOrgDefault) {
        await persist(withOrgPolicy(snapshot, draft))
        setEdited(null)
        toast.success('Organization defaults saved')
        return
      }
      await persist(withOverridePolicy(snapshot, { draft, original, isNew }))
      setEdited(null)
      toast.success(isNew ? 'Workspace override added' : 'Workspace override saved')
      onSaved(draft.workspaceIds[0])
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  return (
    <PolicyDetail
      name={name}
      draft={draft}
      isNew={isNew}
      dirty={dirty}
      isSaving={update.isPending}
      workspaceOptions={workspaceOptions}
      onChange={(next) => {
        if (!update.isPending) setEdited(next)
      }}
      onBack={() => requestSettingsLeave(onClose)}
      onDiscard={() => setEdited(null)}
      onSave={() => void save()}
      onRemove={async () => {
        await persist(withoutOverride(snapshot, original.workspaceIds))
        toast.success('Workspace override removed')
        onClose()
      }}
    />
  )
}

interface RetentionPoliciesProps {
  data: DataRetentionResponse
  workspaces: { id: string; name: string }[]
  onOpen: (id: string) => void
  onCreate: () => void
}

function RetentionPolicies({ data, workspaces, onOpen, onCreate }: RetentionPoliciesProps) {
  const { snapshot, workspaceOptions, workspaceName, withOverrides } = retentionModel(
    data,
    workspaces
  )
  const taken = new Set(withOverrides)
  const hasFreeWorkspace = workspaceOptions.some((option) => !taken.has(option.value))
  return (
    <SettingsSection title='Retention policies'>
      <ResourceList>
        <ActivityRow
          title='Organization'
          detail={orgPolicySummary(snapshot)}
          textMetadata='Default'
          onOpen={() => onOpen(ORGANIZATION_POLICY)}
        />
        {withOverrides.map((workspaceId) => (
          <ActivityRow
            key={workspaceId}
            title={workspaceName(workspaceId)}
            detail={overridePolicySummary(snapshot, workspaceId)}
            onOpen={() => onOpen(workspaceId)}
          />
        ))}
      </ResourceList>
      <SettingsRow
        label='Workspace override'
        description='Set a different policy for some workspaces'
      >
        <Button icon='I074' disabled={!hasFreeWorkspace} onClick={onCreate}>
          Add override
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}

export default function DataRetentionSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const retention = useOrganizationRetention(organizationId)
  const workspaces = useOrganizationWorkspaces(organizationId)
  const subview = useSettingsSubview({ idParam: 'policy', createParam: 'createOverride' })
  const gated = organization.deployment.billingEnabled && retention.data?.isEnterprise === false

  if ((subview.id !== null || subview.creating) && (retention.isPending || workspaces.isPending)) {
    return null
  }

  if (retention.data && workspaces.data && !gated) {
    const { snapshot, workspaceOptions, workspaceName, withOverrides } = retentionModel(
      retention.data,
      workspaces.data
    )
    const openId =
      subview.id === ORGANIZATION_POLICY || (subview.id && withOverrides.includes(subview.id))
        ? subview.id
        : null
    if (subview.creating || openId) {
      const original = subview.creating
        ? newOverrideDraft()
        : openId === ORGANIZATION_POLICY
          ? orgPolicyDraft(snapshot)
          : overrideDraft(snapshot, openId as string)
      /** Excludes workspaces held by other overrides. */
      const others = new Set(withOverrides.filter((id) => !original.workspaceIds.includes(id)))
      return (
        <SectionStack>
          <PolicyEditor
            key={`${organizationId}:${subview.creating ? 'create' : openId}`}
            name={openId ? workspaceName(openId) : ''}
            organizationId={organizationId}
            snapshot={snapshot}
            original={original}
            isNew={subview.creating}
            workspaceOptions={workspaceOptions.filter((option) => !others.has(option.value))}
            onClose={subview.close}
            onSaved={(workspaceId) => {
              if (subview.creating || workspaceId !== openId) subview.showCreated(workspaceId)
            }}
          />
        </SectionStack>
      )
    }
  }

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SettingsRead query={retention} failureMessage='Failed to load data retention settings'>
        {(data) =>
          gated ? (
            <SettingsList
              title='Retention policies'
              empty={{ title: 'Data retention is available on Enterprise plans' }}
            />
          ) : (
            <SettingsRead query={workspaces} failureMessage='Failed to load workspaces'>
              {(workspaceList) => (
                <RetentionPolicies
                  data={data}
                  workspaces={workspaceList}
                  onOpen={subview.open}
                  onCreate={subview.create}
                />
              )}
            </SettingsRead>
          )
        }
      </SettingsRead>
    </SectionStack>
  )
}
