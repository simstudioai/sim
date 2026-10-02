'use client'

import { type ReactNode, useState } from 'react'
import {
  Checkbox,
  Chip,
  ChipConfirmModal,
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
import { generateId } from '@sim/utils/id'
import { CustomPatternsEditor } from '@/components/pii/custom-patterns-editor'
import { ProjectEnvironmentSelect } from '@/components/settings/project-environment-select'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import type { UpdateOrganizationDataRetentionBody } from '@/lib/api/contracts/organization'
import type { ProjectRetentionOverride, RetentionOverride } from '@/lib/api/contracts/primitives'
import type { ProjectApi } from '@/lib/api/contracts/projects'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  type CustomPiiPattern,
  emptyPiiStages,
  getEntityGroupsForLanguage,
  isEntitySupportedForLanguage,
  normalizeRuleStages,
  PII_LANGUAGES,
  PII_STAGE_META,
  PII_STAGES,
  type PIIEntityType,
  type PIILanguage,
  type PiiStageKey,
  type PiiStagePolicy,
  type PiiStages,
  sanitizeCustomPatterns,
  stripNerEntities,
} from '@/lib/guardrails/pii-entities'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import {
  type DataRetentionResponse,
  useOrganizationRetention,
  useUpdateOrganizationRetention,
} from '@/ee/data-retention/hooks/data-retention'
import { useOrganizationProjectsQuery } from '@/hooks/queries/projects'

const logger = createLogger('DataRetentionSettings')

/** Sentinel `RetentionSelect` value meaning "inherit the org-level value". */
const INHERIT = 'inherit'

const DAY_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: '1825', label: '5 years' },
  { value: 'never', label: 'Forever' },
] as const

interface PiiOverride {
  id: string
  workspaceId: string
  stages: PiiStages
}

/**
 * Unified editable shape for one retention policy — the organization default
 * (`isOrgDefault`) or a workspace override. Retention fields hold
 * `RetentionSelect` values; for overrides `INHERIT` means "use the org value".
 * `piiOverride` gates the PII grid (always on for the org default; toggled by
 * the inherit/override switch for workspace overrides).
 */
interface PolicyDraft {
  isOrgDefault: boolean
  projectIds: string[]
  workspaceIds: string[]
  logDays: string
  softDeleteDays: string
  taskCleanupDays: string
  piiOverride: boolean
  piiStages: PiiStages
}

interface EditingPolicy {
  draft: PolicyDraft
  original: PolicyDraft
  isNew: boolean
}

/** Day bounds the retention contract accepts (1 day … 5 years). */
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 1825

/**
 * Hours → display days, clamped to the contract's range. Sub-day values would
 * otherwise round to `0` and be re-sent as `0`, wedging every save on the page.
 */
function clampDisplayDays(hours: number): string {
  const days = Math.round(hours / 24)
  return String(Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, days)))
}

/** Day count → hours. Throws rather than send a value the contract rejects. */
function toRetentionHours(days: string): number {
  const parsed = Number(days)
  if (!Number.isFinite(parsed) || parsed < MIN_RETENTION_DAYS) {
    throw new Error(`Invalid retention period: ${JSON.stringify(days)}`)
  }
  return Math.min(MAX_RETENTION_DAYS, Math.round(parsed)) * 24
}

function hoursToDisplayDays(hours: number | null): string {
  if (hours === null) return 'never'
  return clampDisplayDays(hours)
}

function daysToHours(days: string): number | null {
  if (days === 'never') return null
  return toRetentionHours(days)
}

/** Override field: `INHERIT` ⇄ undefined, `'never'` ⇄ null (forever), day count ⇄ hours. */
function hoursToOverrideValue(hours: number | null | undefined): string {
  if (hours === undefined) return INHERIT
  if (hours === null) return 'never'
  return clampDisplayDays(hours)
}

function overrideValueToHours(value: string): number | null | undefined {
  if (value === INHERIT) return undefined
  if (value === 'never') return null
  return toRetentionHours(value)
}

/**
 * Builds a workspace override from the editable fields, starting from the override being replaced so
 * fields this form does not edit (such as the API-only `fileVersionRetentionHours`) survive a save.
 */
function buildRetentionOverride(
  workspaceId: string,
  draft: PolicyDraft,
  existing: RetentionOverride | undefined
): RetentionOverride | null {
  const override: RetentionOverride = { ...existing, workspaceId }
  const edited = {
    logRetentionHours: overrideValueToHours(draft.logDays),
    softDeleteRetentionHours: overrideValueToHours(draft.softDeleteDays),
    taskCleanupHours: overrideValueToHours(draft.taskCleanupDays),
  }
  for (const [field, hours] of Object.entries(edited) as [
    keyof typeof edited,
    number | null | undefined,
  ][]) {
    if (hours === undefined) delete override[field]
    else override[field] = hours
  }
  return Object.keys(override).length > 1 ? override : null
}

/** Stable serialization of a stage set for dirty-detection. */
function serializeStages(
  stages: PiiStages
): Array<[PiiStageKey, boolean, string[], PIILanguage, CustomPiiPattern[]]> {
  return PII_STAGES.map((key) => {
    const policy = stages[key]
    return [
      key,
      policy.enabled,
      [...policy.entityTypes].sort(),
      policy.language,
      policy.customPatterns ?? [],
    ] as [PiiStageKey, boolean, string[], PIILanguage, CustomPiiPattern[]]
  })
}

function normalizePolicyDraft(draft: PolicyDraft): string {
  return JSON.stringify({
    isOrgDefault: draft.isOrgDefault,
    workspaceIds: [...draft.workspaceIds].sort(),
    projectIds: [...draft.projectIds].sort(),
    logDays: draft.logDays,
    softDeleteDays: draft.softDeleteDays,
    taskCleanupDays: draft.taskCleanupDays,
    piiOverride: draft.piiOverride,
    piiStages: draft.piiOverride ? serializeStages(draft.piiStages) : [],
  })
}

/** A stage is "on" iff it has at least one entity type or custom pattern. */
function stageHasContent(policy: PiiStagePolicy): boolean {
  return policy.entityTypes.length > 0 || (policy.customPatterns?.length ?? 0) > 0
}

function anyStageHasContent(stages: PiiStages): boolean {
  return PII_STAGES.some((key) => stageHasContent(stages[key]))
}

/** Persist-time guarantee that `enabled` mirrors "has content" for every stage. */
function withSyncedEnabled(stages: PiiStages): PiiStages {
  return PII_STAGES.reduce((acc, key) => {
    // Block outputs are regex-only — strip any NER before persisting.
    const entityTypes =
      key === 'blockOutputs' ? stripNerEntities(stages[key].entityTypes) : stages[key].entityTypes
    // Drop half-typed rows (empty regex) so the boundary contract never rejects the save.
    const customPatterns = sanitizeCustomPatterns(stages[key].customPatterns)
    acc[key] = {
      ...stages[key],
      entityTypes,
      customPatterns,
      enabled: entityTypes.length > 0 || customPatterns.length > 0,
    }
    return acc
  }, {} as PiiStages)
}

/** Prune entity selections that the chosen language has no recognizer for. */
function pruneEntitiesForLanguage(entityTypes: string[], language: PIILanguage): string[] {
  return entityTypes.filter((t) => isEntitySupportedForLanguage(t as PIIEntityType, language))
}

/** Row-summary fragment, e.g. "Input 3 · Outputs off · Logs 5". */
function stageSummary(stages: PiiStages): string {
  const short: Record<PiiStageKey, string> = {
    input: 'Input',
    blockOutputs: 'Outputs',
    logs: 'Logs',
  }
  return PII_STAGES.map((key) => {
    const policy = stages[key]
    const count = policy.entityTypes.length + (policy.customPatterns?.length ?? 0)
    return `${short[key]} ${stageHasContent(policy) ? count : 'off'}`
  }).join(' · ')
}

/** Row-summary label for a retention field driven by stored hours. */
function retentionLabel(hours: number | null | undefined): string {
  if (hours === undefined) return 'inherited'
  if (hours === null) return 'forever'
  return `${Math.round(hours / 24)}d`
}

/** Row-summary label for a retention field driven by a `RetentionSelect` day value. */
function dayValueLabel(days: string): string {
  if (days === 'never') return 'forever'
  if (!days) return '—'
  return `${days}d`
}

interface RetentionSelectProps {
  value: string
  onChange: (value: string) => void
  /** Prepend an "Inherit defaults" option (workspace-override fields). */
  allowInherit?: boolean
}

function RetentionSelect({ value, onChange, allowInherit = false }: RetentionSelectProps) {
  const base = DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
  const withInherit = allowInherit ? [{ value: INHERIT, label: 'Inherit defaults' }, ...base] : base
  const isKnown = value === INHERIT || DAY_OPTIONS.some((o) => o.value === value)
  const options = isKnown
    ? withInherit
    : [...withInherit, { value, label: `${value} days (custom)` }]

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
    const merged = { ...value, ...patch }
    const enabled = merged.entityTypes.length > 0 || (merged.customPatterns?.length ?? 0) > 0
    onChange({ ...merged, enabled })
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
  projects: ProjectApi[]
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
  projects,
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
      ? 'Add project override'
      : 'Edit retention override'
  const description = isOrg
    ? 'Applied to environments without a project or environment override.'
    : 'Applies to the selected projects and environments. Environment overrides take precedence over project defaults.'

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
            saveDisabled:
              !isOrg && draft.workspaceIds.length === 0 && draft.projectIds.length === 0,
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
        {!isOrg && (
          <SettingsSection label='Projects'>
            <ProjectEnvironmentSelect
              projects={projects}
              value={{ projectIds: draft.projectIds, workspaceIds: draft.workspaceIds }}
              onChange={(selection) => onChange({ ...draft, ...selection })}
              disabled={isSaving}
              fullWidth
              aria-label='Projects'
            />
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
                  Inherit defaults or set redaction for this selection
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
                Overriding replaces all three redaction stages for the selected scope.
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
      </SettingsPanel>

      <ChipConfirmModal
        open={showRemoveConfirm}
        onOpenChange={setShowRemoveConfirm}
        title='Remove override'
        text={[
          'This removes the retention and PII redaction override for ',
          {
            text:
              draft.projectIds.length + draft.workspaceIds.length === 1
                ? 'this selection'
                : 'these selections',
            bold: true,
          },
          { text: '. They will fall back to their inherited defaults.', error: true },
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
  projects: ProjectApi[]
}

function DataRetentionForm({ initialData: data, orgId, projects }: DataRetentionFormProps) {
  const updateMutation = useUpdateOrganizationRetention()
  const workspaceOptions = projects.flatMap((project) =>
    project.workspaces.map((environment) => ({
      value: environment.id,
      label: `${project.name} / ${environment.name}`,
    }))
  )
  const workspaceName = (id: string) =>
    workspaceOptions.find((environment) => environment.value === id)?.label ??
    'Unavailable environment'
  const [projectOverrides, setProjectOverrides] = useState<ProjectRetentionOverride[]>(
    () => data.configured.projectOverrides ?? []
  )

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
  const guard = useSettingsUnsavedGuard({ isDirty: editingChanged })

  const overrideWorkspaceIds = Array.from(
    new Set([...overrides.map((o) => o.workspaceId), ...piiOverrides.map((p) => p.workspaceId)])
  ).sort((a, b) => workspaceName(a).localeCompare(workspaceName(b)))
  function orgRowSummary(): string {
    const parts = [
      `Log ${dayValueLabel(logDays)}`,
      `Soft-delete ${dayValueLabel(softDeleteDays)}`,
      `Task ${dayValueLabel(taskCleanupDays)}`,
    ]
    parts.push(
      defaultPii && anyStageHasContent(defaultPii.stages)
        ? `PII: ${stageSummary(defaultPii.stages)}`
        : 'No PII'
    )
    return parts.join(' · ')
  }

  function overrideRowSummary(workspaceId: string): string {
    const ov = overrides.find((o) => o.workspaceId === workspaceId)
    const pii = piiOverrides.find((p) => p.workspaceId === workspaceId)
    const parts = [
      `Log ${retentionLabel(ov?.logRetentionHours)}`,
      `Soft-delete ${retentionLabel(ov?.softDeleteRetentionHours)}`,
      `Task ${retentionLabel(ov?.taskCleanupHours)}`,
    ]
    parts.push(pii ? `PII: ${stageSummary(pii.stages)}` : 'PII inherited')
    return parts.join(' · ')
  }

  /**
   * Persist a full snapshot of org hours + PII rules + retention overrides in
   * one PUT. The route replaces each provided key, so always sending the whole
   * state keeps the three editable surfaces consistent.
   */
  async function persistSnapshot(next: {
    logDays: string
    softDeleteDays: string
    taskCleanupDays: string
    defaultPii: Omit<PiiOverride, 'workspaceId'> | null
    piiOverrides: PiiOverride[]
    overrides: RetentionOverride[]
    projectOverrides: ProjectRetentionOverride[]
  }) {
    if (!orgId) return
    const settings: UpdateOrganizationDataRetentionBody = {
      logRetentionHours: daysToHours(next.logDays),
      softDeleteRetentionHours: daysToHours(next.softDeleteDays),
      taskCleanupHours: daysToHours(next.taskCleanupDays),
      retentionOverrides: next.overrides,
      projectOverrides: next.projectOverrides,
    }
    const rules: { id: string; workspaceId: string | null; stages: PiiStages }[] =
      next.piiOverrides.map((p) => ({
        id: p.id,
        workspaceId: p.workspaceId,
        stages: withSyncedEnabled(p.stages),
      }))
    if (next.defaultPii) {
      rules.unshift({
        id: next.defaultPii.id,
        workspaceId: null,
        stages: withSyncedEnabled(next.defaultPii.stages),
      })
    }
    settings.piiRedaction = { rules }
    await updateMutation.mutateAsync({ orgId, settings })
    setLogDays(next.logDays)
    setSoftDeleteDays(next.softDeleteDays)
    setTaskCleanupDays(next.taskCleanupDays)
    setOverrides(next.overrides)
    setProjectOverrides(next.projectOverrides)
    setDefaultPii(next.defaultPii)
    setPiiOverrides(next.piiOverrides)
  }

  function snapshot() {
    return {
      logDays,
      softDeleteDays,
      taskCleanupDays,
      defaultPii,
      piiOverrides,
      overrides,
      projectOverrides,
    }
  }

  function openEditOrg() {
    const draft: PolicyDraft = {
      isOrgDefault: true,
      workspaceIds: [],
      projectIds: [],
      logDays,
      softDeleteDays,
      taskCleanupDays,
      piiOverride: true,
      piiStages: defaultPii?.stages ?? emptyPiiStages(),
    }
    setEditing({ draft, original: draft, isNew: false })
  }

  function openAddOverride() {
    if (!projects.length) return
    const draft: PolicyDraft = {
      isOrgDefault: false,
      workspaceIds: [],
      projectIds: [],
      logDays: INHERIT,
      softDeleteDays: INHERIT,
      taskCleanupDays: INHERIT,
      piiOverride: false,
      piiStages: emptyPiiStages(),
    }
    setEditing({ draft, original: draft, isNew: true })
  }

  function openEditOverride(workspaceId: string) {
    const ov = overrides.find((o) => o.workspaceId === workspaceId)
    const pii = piiOverrides.find((p) => p.workspaceId === workspaceId)
    const draft: PolicyDraft = {
      isOrgDefault: false,
      workspaceIds: [workspaceId],
      projectIds: [],
      logDays: hoursToOverrideValue(ov?.logRetentionHours),
      softDeleteDays: hoursToOverrideValue(ov?.softDeleteRetentionHours),
      taskCleanupDays: hoursToOverrideValue(ov?.taskCleanupHours),
      piiOverride: Boolean(pii),
      piiStages: pii?.stages ?? emptyPiiStages(),
    }
    setEditing({ draft, original: draft, isNew: false })
  }

  function openEditProjectOverride(override: ProjectRetentionOverride) {
    const draft: PolicyDraft = {
      isOrgDefault: false,
      projectIds: [override.projectId],
      workspaceIds: [],
      logDays: hoursToOverrideValue(override.logRetentionHours),
      softDeleteDays: hoursToOverrideValue(override.softDeleteRetentionHours),
      taskCleanupDays: hoursToOverrideValue(override.taskCleanupHours),
      piiOverride: Boolean(override.piiStages),
      piiStages: override.piiStages
        ? normalizeRuleStages({ stages: override.piiStages })
        : emptyPiiStages(),
    }
    setEditing({ draft, original: draft, isNew: false })
  }

  function closeEditing() {
    setEditing(null)
  }

  function handleDiscard() {
    if (editing) setEditing({ ...editing, draft: editing.original })
  }

  async function savePolicy() {
    if (!editing) return
    const draft = editing.draft
    try {
      if (draft.isOrgDefault) {
        await persistSnapshot({
          ...snapshot(),
          logDays: draft.logDays,
          softDeleteDays: draft.softDeleteDays,
          taskCleanupDays: draft.taskCleanupDays,
          defaultPii: anyStageHasContent(draft.piiStages)
            ? {
                id: defaultPii?.id ?? generateId(),
                stages: draft.piiStages,
              }
            : null,
        })
        closeEditing()
        toast.success('Organization defaults saved.')
        return
      }

      if (
        draft.projectIds.some(
          (id) =>
            projectOverrides.some((override) => override.projectId === id) &&
            !editing.original.projectIds.includes(id)
        )
      ) {
        toast.error(
          'This project already has a policy. Edit that policy or select individual environments.'
        )
        return
      }
      if (
        draft.workspaceIds.some(
          (id) => overrideWorkspaceIds.includes(id) && !editing.original.workspaceIds.includes(id)
        )
      ) {
        toast.error('This environment already has a policy. Edit that policy instead.')
        return
      }
      const ids = draft.workspaceIds
      if (ids.length === 0 && draft.projectIds.length === 0) return
      const clearProjectIds = new Set([...editing.original.projectIds, ...draft.projectIds])
      const nextProjectOverrides = projectOverrides.filter(
        (override) => !clearProjectIds.has(override.projectId)
      )
      for (const projectId of draft.projectIds) {
        const previous = projectOverrides.find((override) => override.projectId === projectId)
        const retention = buildRetentionOverride(
          projectId,
          draft,
          previous
            ? {
                workspaceId: projectId,
                fileVersionRetentionHours: previous.fileVersionRetentionHours,
              }
            : undefined
        )
        const { workspaceId: _workspaceId, ...hours } = retention ?? { workspaceId: projectId }
        nextProjectOverrides.push({
          projectId,
          ...hours,
          ...(draft.piiOverride ? { piiStages: withSyncedEnabled(draft.piiStages) } : {}),
        })
      }
      const clearIds = new Set([...editing.original.workspaceIds, ...ids])
      const nextOverrides = overrides.filter((o) => !clearIds.has(o.workspaceId))
      const nextPiiOverrides = piiOverrides.filter((p) => !clearIds.has(p.workspaceId))
      /** An edited override moved to another workspace keeps what only the API can set. */
      const replacedOverride =
        editing.original.workspaceIds.length === 1
          ? overrides.find((o) => o.workspaceId === editing.original.workspaceIds[0])
          : undefined
      for (const workspaceId of ids) {
        const ov = buildRetentionOverride(
          workspaceId,
          draft,
          overrides.find((o) => o.workspaceId === workspaceId) ?? replacedOverride
        )
        if (ov) nextOverrides.push(ov)
        if (draft.piiOverride) {
          const existing = piiOverrides.find((p) => p.workspaceId === workspaceId)
          nextPiiOverrides.push({
            id: existing?.id ?? generateId(),
            workspaceId,
            stages: draft.piiStages,
          })
        }
      }
      await persistSnapshot({
        ...snapshot(),
        overrides: nextOverrides,
        projectOverrides: nextProjectOverrides,
        piiOverrides: nextPiiOverrides,
      })
      closeEditing()
      toast.success('Retention override saved.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to save data retention policy', { error: msg })
      toast.error(msg)
    }
  }

  async function removeCurrentOverride() {
    if (!editing || editing.draft.isOrgDefault) return
    const idSet = new Set(editing.original.workspaceIds)
    try {
      await persistSnapshot({
        ...snapshot(),
        overrides: overrides.filter((o) => !idSet.has(o.workspaceId)),
        projectOverrides: projectOverrides.filter(
          (override) => !editing.original.projectIds.includes(override.projectId)
        ),
        piiOverrides: piiOverrides.filter((p) => !idSet.has(p.workspaceId)),
      })
      closeEditing()
      toast.success('Retention override removed.')
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
      disabled: !projects.length,
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
          projects={projects}
          onChange={(draft) => setEditing({ ...editing, draft })}
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
                description={orgRowSummary()}
                badge={<ChipTag variant='gray'>Default</ChipTag>}
                onClick={openEditOrg}
                clickLabel='Open organization retention policy'
                navigable
              />
              {projectOverrides.map((override) => {
                const name =
                  projects.find((project) => project.id === override.projectId)?.name ??
                  'Unavailable project'
                return (
                  <SettingsResourceRow
                    key={override.projectId}
                    title={name}
                    description='All current and future environments'
                    onClick={() => openEditProjectOverride(override)}
                    clickLabel={`Open ${name} retention override`}
                    navigable
                  />
                )
              })}
              {overrideWorkspaceIds.map((workspaceId) => (
                <SettingsResourceRow
                  key={workspaceId}
                  title={workspaceName(workspaceId)}
                  description={overrideRowSummary(workspaceId)}
                  onClick={() => openEditOverride(workspaceId)}
                  clickLabel={`Open ${workspaceName(workspaceId)} retention override`}
                  navigable
                />
              ))}
            </div>
          </SettingsSection>
        </SettingsPanel>
      )}
      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}

export function DataRetentionSettings({ organizationId: orgId }: DataRetentionSettingsProps) {
  const { data, isLoading } = useOrganizationRetention(orgId)
  const projects = useOrganizationProjectsQuery(orgId)
  const { billingEnabled } = useDeploymentShape()

  if (isLoading || projects.isPending) {
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

  if (projects.error) return <SettingsEmptyState>{projects.error.message}</SettingsEmptyState>
  if (!data) {
    return <SettingsEmptyState>Failed to load data retention settings.</SettingsEmptyState>
  }

  if (billingEnabled && !data.isEnterprise) {
    return (
      <SettingsEmptyState>Data retention is available on Enterprise plans only.</SettingsEmptyState>
    )
  }

  return (
    <DataRetentionForm
      key={orgId}
      initialData={data}
      orgId={orgId}
      projects={projects.data ?? []}
    />
  )
}
