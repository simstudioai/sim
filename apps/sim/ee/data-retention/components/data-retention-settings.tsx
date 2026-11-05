'use client'

import { type ReactNode, useState } from 'react'
import {
  Checkbox,
  Chip,
  ChipConfirmModal,
  ChipDropdown,
  ChipInput,
  ChipSelect,
  ChipSwitch,
  ChipTag,
  Info,
  OverflowText,
  Search,
  toast,
} from '@sim/emcn'
import { ArrowLeft, Plus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { CustomPatternsEditor } from '@/components/pii/custom-patterns-editor'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import type { RetentionOverride } from '@/lib/api/contracts/primitives'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  getEntityGroupsForLanguage,
  normalizeRuleStages,
  PII_LANGUAGES,
  PII_STAGE_META,
  type PIIEntityType,
  type PIILanguage,
  type PiiStageKey,
  type PiiStagePolicy,
} from '@/lib/guardrails/pii-entities'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
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
  type PiiOverride,
  type PolicyDraft,
  pruneEntitiesForLanguage,
  type RetentionSnapshot,
  retentionSelectOptions,
  stageHasContent,
  updateStagePolicy,
  withOrgPolicy,
  withOverridePolicy,
  withoutOverride,
} from '@/ee/data-retention/lib/policy-draft'
import { useWorkspacesQuery, type Workspace } from '@/hooks/queries/workspace'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'

const logger = createLogger('DataRetentionSettings')

interface RetentionSelectProps {
  value: string
  onChange: (value: string) => void
  /** Prepend an "Inherit from organization" option (workspace-override fields). */
  allowInherit?: boolean
}

function RetentionSelect({ value, onChange, allowInherit = false }: RetentionSelectProps) {
  const options = retentionSelectOptions(value, allowInherit)

  return <ChipSelect value={value} onChange={onChange} options={options} align='start' />
}

interface EntityCheckboxGridProps {
  groups: ReadonlyArray<{
    label: string
    entities: ReadonlyArray<{ value: PIIEntityType; label: string }>
  }>
  selected: string[]
  onChange: (entityTypes: string[]) => void
  /** Optional control rendered directly beneath the search row (e.g. language). */
  belowSearch?: ReactNode
}

function EntityCheckboxGrid({
  groups: sourceGroups,
  selected,
  onChange,
  belowSearch,
}: EntityCheckboxGridProps) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()

  const groups = sourceGroups
    .map((group) => ({
      label: group.label,
      entities: query
        ? group.entities.filter(
            (e) => e.label.toLowerCase().includes(query) || e.value.toLowerCase().includes(query)
          )
        : group.entities,
    }))
    .filter((group) => group.entities.length > 0)

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className='flex flex-col gap-3'>
      <ChipInput
        icon={Search}
        placeholder='Search PII types...'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className='w-full'
      />
      {belowSearch}
      <div className='flex flex-col gap-3'>
        {groups.map((group) => (
          <div key={group.label} className='flex flex-col gap-1.5'>
            <span className='text-[var(--text-muted)] text-small'>{group.label}</span>
            <div className='grid grid-cols-2 gap-x-2 gap-y-0.5'>
              {group.entities.map((entity) => {
                const checkboxId = `pii-${entity.value}`
                return (
                  <label
                    key={entity.value}
                    htmlFor={checkboxId}
                    className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={selected.includes(entity.value)}
                      onCheckedChange={() => toggle(entity.value)}
                    />
                    <OverflowText label={entity.label} className='text-sm' />
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface PiiLanguageSelectProps {
  value: PIILanguage
  onChange: (language: PIILanguage) => void
}

function PiiLanguageSelect({ value, onChange }: PiiLanguageSelectProps) {
  return (
    <ChipSelect
      value={value}
      onChange={(language) => onChange(language as PIILanguage)}
      options={PII_LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
      align='start'
    />
  )
}

interface PiiStagePanelProps {
  stageKey: PiiStageKey
  description: string
  value: PiiStagePolicy
  onChange: (next: PiiStagePolicy) => void
}

/**
 * The config body for the currently-selected redaction stage (tab panel). The
 * stage is "on" purely by virtue of having entity types selected — `enabled` is
 * kept in sync with that, so there is no separate toggle.
 */
function PiiStagePanel({ stageKey, description, value, onChange }: PiiStagePanelProps) {
  // Block outputs run in-flight on large payloads, so they are restricted to the
  // regex/checksum recognizers (no spaCy NER) — see the server fast path.
  const groups = getEntityGroupsForLanguage(value.language, {
    regexOnly: stageKey === 'blockOutputs',
  })

  function update(patch: Partial<PiiStagePolicy>) {
    onChange(updateStagePolicy(value, patch))
  }

  return (
    <div className='flex flex-col gap-4'>
      <span className='text-[var(--text-muted)] text-small'>{description}</span>

      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-1.5'>
          <span className='text-[var(--text-muted)] text-small'>Entity types</span>
          <Info side='top' align='start'>
            Loose numeric recognizers (US Social Security Number, US bank account number) and Date
            or time match aggressively and frequently over-redact. Enable these only where false
            positives are acceptable.
          </Info>
        </div>
        <EntityCheckboxGrid
          groups={groups}
          selected={value.entityTypes}
          onChange={(entityTypes) => update({ entityTypes })}
          belowSearch={
            <div className='flex items-center justify-between gap-3'>
              <span className='text-[var(--text-muted)] text-small'>Language</span>
              <PiiLanguageSelect
                value={value.language}
                onChange={(language) =>
                  update({
                    language,
                    entityTypes: pruneEntitiesForLanguage(value.entityTypes, language),
                  })
                }
              />
            </div>
          }
        />
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-1.5'>
          <span className='text-[var(--text-muted)] text-small'>Custom patterns</span>
          <Info side='top' align='start'>
            Redact anything a regular expression can match (employee ids, internal urls, ticket
            numbers). Each match is replaced with its replacement text, wrapped in angle brackets
            (e.g. EMPLOYEE_ID → &lt;EMPLOYEE_ID&gt;).
          </Info>
        </div>
        <CustomPatternsEditor
          patterns={value.customPatterns ?? []}
          onChange={(customPatterns) => update({ customPatterns })}
        />
      </div>
    </div>
  )
}

interface PolicyDetailProps {
  draft: PolicyDraft
  isNew: boolean
  changed: boolean
  isSaving: boolean
  canRemove: boolean
  workspaceOptions: { value: string; label: string }[]
  onChange: (draft: PolicyDraft) => void
  onBack: () => void
  onDiscard: () => void
  onSave: () => void
  onRemove: () => void
}

function PolicyDetail({
  draft,
  isNew,
  changed,
  isSaving,
  canRemove,
  workspaceOptions,
  onChange,
  onBack,
  onDiscard,
  onSave,
  onRemove,
}: PolicyDetailProps) {
  const isOrg = draft.isOrgDefault
  const showPiiGrid = isOrg || draft.piiOverride
  const [activeStage, setActiveStage] = useState<PiiStageKey>(
    () =>
      PII_STAGE_META.find((s) => stageHasContent(draft.piiStages[s.key]))?.key ??
      PII_STAGE_META[0].key
  )
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const activeStageMeta = PII_STAGE_META.find((s) => s.key === activeStage) ?? PII_STAGE_META[0]
  const title = isOrg
    ? 'Organization defaults'
    : isNew
      ? 'Add workspace override'
      : 'Edit workspace override'
  const description = isOrg
    ? 'Applied to every workspace without its own override.'
    : 'Overrides the organization defaults for the selected workspaces.'

  return (
    <>
      <SettingsPanel
        back={{ text: 'Data retention', icon: ArrowLeft, onSelect: onBack }}
        title={title}
        description={description}
        actions={[
          ...saveDiscardActions({
            dirty: changed,
            saving: isSaving,
            onSave,
            onDiscard,
            saveDisabled: !isOrg && draft.workspaceIds.length === 0,
          }),
          ...(canRemove
            ? [
                {
                  id: 'delete',
                  text: 'Remove override',
                  onSelect: () => setShowRemoveConfirm(true),
                  disabled: isSaving,
                } satisfies SettingsAction,
              ]
            : []),
        ]}
      >
        <fieldset disabled={isSaving} className='flex min-w-0 flex-col gap-7'>
          {!isOrg && (
            <SettingsSection label='Workspaces'>
              <div className='flex items-center justify-between gap-3'>
                <span className='min-w-0 text-[var(--text-muted)] text-small'>
                  {draft.workspaceIds.length > 0
                    ? `Overrides ${draft.workspaceIds.length} workspace${draft.workspaceIds.length === 1 ? '' : 's'}`
                    : 'Select the workspaces this override applies to'}
                </span>
                <ChipDropdown
                  multiple
                  showAllOption={false}
                  allLabel='Select workspaces'
                  value={draft.workspaceIds}
                  onChange={(workspaceIds) => onChange({ ...draft, workspaceIds })}
                  options={workspaceOptions}
                  className='shrink-0'
                />
              </div>
            </SettingsSection>
          )}

          <SettingsSection label='Retention'>
            <div className='flex flex-col gap-3'>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-[var(--text-muted)] text-small'>Log retention</span>
                <RetentionSelect
                  allowInherit={!isOrg}
                  value={draft.logDays}
                  onChange={(logDays) => onChange({ ...draft, logDays })}
                />
              </div>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-[var(--text-muted)] text-small'>Soft deletion cleanup</span>
                <RetentionSelect
                  allowInherit={!isOrg}
                  value={draft.softDeleteDays}
                  onChange={(softDeleteDays) => onChange({ ...draft, softDeleteDays })}
                />
              </div>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-[var(--text-muted)] text-small'>Task cleanup</span>
                <RetentionSelect
                  allowInherit={!isOrg}
                  value={draft.taskCleanupDays}
                  onChange={(taskCleanupDays) => onChange({ ...draft, taskCleanupDays })}
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            label='PII redaction'
            action={
              showPiiGrid ? (
                <Chip
                  onClick={() =>
                    onChange({
                      ...draft,
                      piiStages: {
                        ...draft.piiStages,
                        [activeStage]: {
                          ...draft.piiStages[activeStage],
                          entityTypes: [],
                          // Clearing entity types leaves any custom patterns intact,
                          // so the stage stays enabled while patterns remain.
                          enabled: (draft.piiStages[activeStage].customPatterns?.length ?? 0) > 0,
                        },
                      },
                    })
                  }
                  disabled={draft.piiStages[activeStage].entityTypes.length === 0}
                >
                  Deselect all
                </Chip>
              ) : undefined
            }
          >
            <div className='flex flex-col gap-4'>
              {!isOrg && (
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-[var(--text-muted)] text-small'>
                    Inherit the organization defaults or set workspace-specific redaction
                  </span>
                  <ChipSwitch
                    value={draft.piiOverride ? 'override' : 'inherit'}
                    onChange={(mode) => onChange({ ...draft, piiOverride: mode === 'override' })}
                    aria-label='PII redaction override mode'
                    options={[
                      { value: 'inherit', label: 'Inherit' },
                      { value: 'override', label: 'Override' },
                    ]}
                  />
                </div>
              )}
              {!isOrg && draft.piiOverride && (
                <span className='text-[var(--text-muted)] text-caption'>
                  Overriding replaces all three redaction stages for this workspace.
                </span>
              )}
              {showPiiGrid && (
                <>
                  <ChipSwitch
                    value={activeStage}
                    onChange={setActiveStage}
                    aria-label='Redaction stage'
                    options={PII_STAGE_META.map((stage) => ({
                      value: stage.key,
                      label: stage.label,
                    }))}
                  />
                  <PiiStagePanel
                    stageKey={activeStage}
                    description={activeStageMeta.description}
                    value={draft.piiStages[activeStage]}
                    onChange={(next) =>
                      onChange({
                        ...draft,
                        piiStages: { ...draft.piiStages, [activeStage]: next },
                      })
                    }
                  />
                </>
              )}
            </div>
          </SettingsSection>
        </fieldset>
      </SettingsPanel>

      <ChipConfirmModal
        open={showRemoveConfirm}
        onOpenChange={setShowRemoveConfirm}
        title='Remove override'
        text={[
          'This removes the retention and PII redaction override for ',
          {
            text:
              draft.workspaceIds.length === 1
                ? 'this workspace'
                : `these ${draft.workspaceIds.length} workspaces`,
            bold: true,
          },
          { text: '. They will fall back to the organization defaults.', error: true },
        ]}
        confirm={{
          label: 'Remove override',
          onClick: onRemove,
          pending: isSaving,
          pendingLabel: 'Removing...',
        }}
      />
    </>
  )
}

interface DataRetentionSettingsProps {
  organizationId: string
}

interface DataRetentionFormProps {
  initialData: DataRetentionResponse
  orgId: string
  workspaces: Workspace[]
}

function DataRetentionForm({ initialData: data, orgId, workspaces }: DataRetentionFormProps) {
  const updateMutation = useUpdateOrganizationRetention()
  const workspaceOptions = workspaces
    .filter((w) => w.organizationId === orgId)
    .map((w) => ({ value: w.id, label: w.name }))
  const workspaceName = (id: string) =>
    workspaceOptions.find((w) => w.value === id)?.label ?? 'Unknown workspace'

  const [logDays, setLogDays] = useState(() => hoursToDisplayDays(data.effective.logRetentionHours))
  const [softDeleteDays, setSoftDeleteDays] = useState(() =>
    hoursToDisplayDays(data.effective.softDeleteRetentionHours)
  )
  const [taskCleanupDays, setTaskCleanupDays] = useState(() =>
    hoursToDisplayDays(data.effective.taskCleanupHours)
  )
  const [defaultPii, setDefaultPii] = useState<Omit<PiiOverride, 'workspaceId'> | null>(() => {
    const defaultRule = data.configured.piiRedaction?.rules?.find(
      (rule) => rule.workspaceId === null
    )
    return defaultRule ? { id: defaultRule.id, stages: normalizeRuleStages(defaultRule) } : null
  })
  const [piiOverrides, setPiiOverrides] = useState<PiiOverride[]>(() =>
    (data.configured.piiRedaction?.rules ?? [])
      .filter((rule) => rule.workspaceId !== null)
      .map((rule) => ({
        id: rule.id,
        workspaceId: rule.workspaceId as string,
        stages: normalizeRuleStages(rule),
      }))
  )
  const [overrides, setOverrides] = useState<RetentionOverride[]>(
    () => data.configured.retentionOverrides ?? []
  )
  const [editing, setEditing] = useState<EditingPolicy | null>(null)

  const editingChanged =
    editing !== null &&
    normalizePolicyDraft(editing.draft) !== normalizePolicyDraft(editing.original)
  const guard = useSettingsUnsavedGuard({
    isDirty: editingChanged,
    navigationBlocked: updateMutation.isPending,
    onDiscard: handleDiscard,
  })

  function snapshot(): RetentionSnapshot {
    return { logDays, softDeleteDays, taskCleanupDays, defaultPii, piiOverrides, overrides }
  }

  const workspacesWithOverrides = overrideWorkspaceIds(snapshot()).sort((a, b) =>
    workspaceName(a).localeCompare(workspaceName(b))
  )
  const takenWorkspaceIds = new Set(workspacesWithOverrides)
  const freeWorkspaces = workspaceOptions.filter((w) => !takenWorkspaceIds.has(w.value))

  /** Options for the detail workspace picker — excludes workspaces taken by OTHER overrides. */
  function workspacePickerOptions(draft: PolicyDraft): { value: string; label: string }[] {
    const others = new Set(workspacesWithOverrides.filter((id) => !draft.workspaceIds.includes(id)))
    return workspaceOptions.filter((w) => !others.has(w.value))
  }

  /**
   * Persist a full snapshot of org hours + PII rules + retention overrides in
   * one PUT. The route replaces each provided key, so always sending the whole
   * state keeps the three editable surfaces consistent.
   */
  async function persistSnapshot(next: RetentionSnapshot) {
    if (!orgId) return
    const settings = buildRetentionUpdate(next)
    await updateMutation.mutateAsync({ orgId, settings })
    setLogDays(next.logDays)
    setSoftDeleteDays(next.softDeleteDays)
    setTaskCleanupDays(next.taskCleanupDays)
    setOverrides(next.overrides)
    setDefaultPii(next.defaultPii)
    setPiiOverrides(next.piiOverrides)
  }

  function openEditOrg() {
    const draft = orgPolicyDraft(snapshot())
    setEditing({ draft, original: draft, isNew: false })
  }

  function openAddOverride() {
    if (freeWorkspaces.length === 0) return
    const draft = newOverrideDraft()
    setEditing({ draft, original: draft, isNew: true })
  }

  function openEditOverride(workspaceId: string) {
    const draft = overrideDraft(snapshot(), workspaceId)
    setEditing({ draft, original: draft, isNew: false })
  }

  function closeEditing() {
    setEditing(null)
  }

  function handleDiscard() {
    if (editing) setEditing({ ...editing, draft: editing.original })
  }

  async function savePolicy() {
    if (!editing || updateMutation.isPending) return
    const draft = editing.draft
    try {
      if (draft.isOrgDefault) {
        await persistSnapshot(withOrgPolicy(snapshot(), draft))
        closeEditing()
        toast.success('Organization defaults saved.')
        return
      }

      if (draft.workspaceIds.length === 0) return
      await persistSnapshot(withOverridePolicy(snapshot(), editing))
      closeEditing()
      toast.success('Workspace override saved.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to save data retention policy', { error: msg })
      toast.error(msg)
    }
  }

  async function removeCurrentOverride() {
    if (!editing || editing.draft.isOrgDefault) return
    try {
      await persistSnapshot(withoutOverride(snapshot(), editing.original.workspaceIds))
      closeEditing()
      toast.success('Workspace override removed.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to remove workspace override', { error: msg })
      toast.error(msg)
    }
  }

  const listActions = [
    {
      id: 'add-override',
      text: 'Add override',
      icon: Plus,
      variant: 'primary' as const,
      onSelect: openAddOverride,
      disabled: freeWorkspaces.length === 0,
    },
  ]

  return (
    <>
      {editing ? (
        <PolicyDetail
          draft={editing.draft}
          isNew={editing.isNew}
          changed={editingChanged}
          isSaving={updateMutation.isPending}
          canRemove={!editing.draft.isOrgDefault && !editing.isNew}
          workspaceOptions={workspacePickerOptions(editing.draft)}
          onChange={(draft) => {
            if (!updateMutation.isPending) setEditing({ ...editing, draft })
          }}
          onBack={() => guard.guardBack(closeEditing)}
          onDiscard={handleDiscard}
          onSave={savePolicy}
          onRemove={removeCurrentOverride}
        />
      ) : (
        <SettingsPanel actions={listActions}>
          <SettingsSection label='Retention policies'>
            <div className={RESOURCE_LIST_STACK}>
              <SettingsResourceRow
                title='Organization'
                description={orgPolicySummary(snapshot())}
                badge={<ChipTag variant='gray'>Default</ChipTag>}
                onClick={openEditOrg}
                clickLabel='Open organization retention policy'
                navigable
              />
              {workspacesWithOverrides.map((workspaceId) => (
                <SettingsResourceRow
                  key={workspaceId}
                  title={workspaceName(workspaceId)}
                  description={overridePolicySummary(snapshot(), workspaceId)}
                  onClick={() => openEditOverride(workspaceId)}
                  clickLabel={`Open ${workspaceName(workspaceId)} retention override`}
                  navigable
                />
              ))}
            </div>
          </SettingsSection>
        </SettingsPanel>
      )}
    </>
  )
}

export function DataRetentionSettings({ organizationId: orgId }: DataRetentionSettingsProps) {
  const { data, isLoading } = useOrganizationRetention(orgId)
  const { data: workspaces = [] } = useWorkspacesQuery(Boolean(orgId))
  const { billingEnabled } = useDeploymentShape()

  if (isLoading) {
    return (
      <SettingsPanel
        actions={[
          {
            id: 'add-override',
            text: 'Add override',
            icon: Plus,
            variant: 'primary',
            disabled: true,
            onSelect: () => undefined,
          },
        ]}
      />
    )
  }

  if (!data) {
    return <SettingsEmptyState>Failed to load data retention settings.</SettingsEmptyState>
  }

  if (billingEnabled && !data.isEnterprise) {
    return (
      <SettingsEmptyState>Data retention is available on Enterprise plans only.</SettingsEmptyState>
    )
  }

  return <DataRetentionForm key={orgId} initialData={data} orgId={orgId} workspaces={workspaces} />
}
