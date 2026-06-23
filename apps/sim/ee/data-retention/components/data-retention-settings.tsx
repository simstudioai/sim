'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { Plus } from 'lucide-react'
import {
  Checkbox,
  Chip,
  ChipDropdown,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  ChipSwitch,
  Search,
  toast,
} from '@/components/emcn'
import type { UpdateOrganizationDataRetentionBody } from '@/lib/api/contracts/organization'
import type { RetentionOverride } from '@/lib/api/contracts/primitives'
import { useSession } from '@/lib/auth/auth-client'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import {
  DEFAULT_PII_LANGUAGE,
  PII_ENTITY_GROUPS,
  PII_LANGUAGES,
  type PIILanguage,
  SUPPORTED_PII_ENTITIES,
} from '@/lib/guardrails/pii-entities'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { SettingRow } from '@/ee/components/setting-row'
import {
  useOrganizationRetention,
  useUpdateOrganizationRetention,
} from '@/ee/data-retention/hooks/data-retention'
import { useOrganizations } from '@/hooks/queries/organization'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

const logger = createLogger('DataRetentionSettings')

const ENTITY_LABELS = SUPPORTED_PII_ENTITIES as Record<string, string>

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

/** Local editable shape of the org-wide (`workspaceId: null`) PII redaction rule. */
interface DefaultPiiDraft {
  id: string
  entityTypes: string[]
  language: PIILanguage
}

/**
 * Local editable shape of a per-workspace override. Retention fields use
 * `RetentionSelect` values (`INHERIT` / `'never'` / a day count). PII is a
 * mode + entities, applied to every selected workspace on save.
 */
interface WorkspaceOverrideDraft {
  workspaceIds: string[]
  logDays: string
  softDeleteDays: string
  taskCleanupDays: string
  piiMode: 'inherit' | 'override'
  piiEntityTypes: string[]
  piiLanguage: PIILanguage
}

type ActiveModal =
  | { kind: 'pii-default'; draft: DefaultPiiDraft; original: DefaultPiiDraft; isNew: boolean }
  | {
      kind: 'workspace'
      draft: WorkspaceOverrideDraft
      original: WorkspaceOverrideDraft
      isNew: boolean
    }

function hoursToDisplayDays(hours: number | null): string {
  if (hours === null) return 'never'
  return String(Math.round(hours / 24))
}

function daysToHours(days: string): number | null {
  if (days === 'never') return null
  return Number(days) * 24
}

/** Override field: `INHERIT` ⇄ undefined, `'never'` ⇄ null (forever), day count ⇄ hours. */
function hoursToOverrideValue(hours: number | null | undefined): string {
  if (hours === undefined) return INHERIT
  if (hours === null) return 'never'
  return String(Math.round(hours / 24))
}

function overrideValueToHours(value: string): number | null | undefined {
  if (value === INHERIT) return undefined
  if (value === 'never') return null
  return Number(value) * 24
}

function buildRetentionOverride(
  workspaceId: string,
  draft: WorkspaceOverrideDraft
): RetentionOverride | null {
  const override: RetentionOverride = { workspaceId }
  const log = overrideValueToHours(draft.logDays)
  const soft = overrideValueToHours(draft.softDeleteDays)
  const task = overrideValueToHours(draft.taskCleanupDays)
  if (log !== undefined) override.logRetentionHours = log
  if (soft !== undefined) override.softDeleteRetentionHours = soft
  if (task !== undefined) override.taskCleanupHours = task
  const hasField =
    override.logRetentionHours !== undefined ||
    override.softDeleteRetentionHours !== undefined ||
    override.taskCleanupHours !== undefined
  return hasField ? override : null
}

function normalizeDefaultPii(draft: DefaultPiiDraft): string {
  return JSON.stringify({ entityTypes: [...draft.entityTypes].sort(), language: draft.language })
}

function normalizeWorkspaceDraft(draft: WorkspaceOverrideDraft): string {
  return JSON.stringify({
    workspaceIds: [...draft.workspaceIds].sort(),
    logDays: draft.logDays,
    softDeleteDays: draft.softDeleteDays,
    taskCleanupDays: draft.taskCleanupDays,
    piiMode: draft.piiMode,
    piiEntityTypes: draft.piiMode === 'override' ? [...draft.piiEntityTypes].sort() : [],
    piiLanguage: draft.piiLanguage,
  })
}

function entitySummary(entityTypes: string[]): string {
  if (entityTypes.length === 0) return 'Not redacted'
  const labels = entityTypes.map((t) => ENTITY_LABELS[t] ?? t)
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
}

function retentionLabel(hours: number | null | undefined): string {
  if (hours === undefined) return 'inherited'
  if (hours === null) return 'forever'
  return `${Math.round(hours / 24)}d`
}

interface RetentionSelectProps {
  value: string
  onChange: (value: string) => void
  /** Prepend an "Inherit from organization" option (workspace-override fields). */
  allowInherit?: boolean
}

function RetentionSelect({ value, onChange, allowInherit = false }: RetentionSelectProps) {
  const base = DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
  const withInherit = allowInherit
    ? [{ value: INHERIT, label: 'Inherit from organization' }, ...base]
    : base
  const isKnown = value === INHERIT || DAY_OPTIONS.some((o) => o.value === value)
  const options = isKnown
    ? withInherit
    : [...withInherit, { value, label: `${value} days (custom)` }]

  return <ChipSelect value={value} onChange={onChange} options={options} align='start' />
}

interface EntityCheckboxGridProps {
  selected: string[]
  onChange: (entityTypes: string[]) => void
}

function EntityCheckboxGrid({ selected, onChange }: EntityCheckboxGridProps) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()

  const groups = PII_ENTITY_GROUPS.map((group) => ({
    label: group.label,
    entities: query
      ? group.entities.filter(
          (e) => e.label.toLowerCase().includes(query) || e.value.toLowerCase().includes(query)
        )
      : group.entities,
  })).filter((group) => group.entities.length > 0)

  const visibleValues: string[] = groups.flatMap((g) => g.entities.map((e) => e.value))
  const allVisibleSelected =
    visibleValues.length > 0 && visibleValues.every((v) => selected.includes(v))

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      onChange(selected.filter((v) => !visibleValues.includes(v)))
    } else {
      onChange([...new Set([...selected, ...visibleValues])])
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder='Search PII types...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='min-w-0 flex-1'
        />
        <Chip onClick={toggleAllVisible} disabled={visibleValues.length === 0}>
          {allVisibleSelected ? 'Deselect all' : 'Select all'}
        </Chip>
      </div>
      <div className='flex flex-col gap-3'>
        {groups.map((group) => (
          <div key={group.label} className='flex flex-col gap-1.5'>
            <span className='font-medium text-[var(--text-muted)] text-small'>{group.label}</span>
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
                    <span className='truncate text-sm'>{entity.label}</span>
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

interface DefaultPiiModalProps {
  draft: DefaultPiiDraft
  isNew: boolean
  isSaving: boolean
  onChange: (draft: DefaultPiiDraft) => void
  onClose: () => void
  onSave: () => void
}

function DefaultPiiModal({
  draft,
  isNew,
  isSaving,
  onChange,
  onClose,
  onSave,
}: DefaultPiiModalProps) {
  return (
    <ChipModal open onOpenChange={onClose} size='xl' srTitle='PII redaction'>
      <ChipModalHeader onClose={onClose}>
        {isNew ? 'Add redaction · all workspaces' : 'Edit redaction · all workspaces'}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Redact'>
          <EntityCheckboxGrid
            selected={draft.entityTypes}
            onChange={(entityTypes) => onChange({ ...draft, entityTypes })}
          />
        </ChipModalField>
        <ChipModalField
          type='custom'
          title='Language'
          hint='Detection runs with this language’s recognizers — match it to your log content.'
        >
          <PiiLanguageSelect
            value={draft.language}
            onChange={(language) => onChange({ ...draft, language })}
          />
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: isSaving ? 'Saving...' : 'Save',
          onClick: onSave,
          disabled: isSaving,
        }}
      />
    </ChipModal>
  )
}

interface WorkspaceOverrideModalProps {
  draft: WorkspaceOverrideDraft
  isNew: boolean
  isSaving: boolean
  piiEnabled: boolean
  workspaceOptions: { value: string; label: string }[]
  onChange: (draft: WorkspaceOverrideDraft) => void
  onClose: () => void
  onSave: () => void
}

function WorkspaceOverrideModal({
  draft,
  isNew,
  isSaving,
  piiEnabled,
  workspaceOptions,
  onChange,
  onClose,
  onSave,
}: WorkspaceOverrideModalProps) {
  return (
    <ChipModal open onOpenChange={onClose} size='xl' srTitle='Workspace override'>
      <ChipModalHeader onClose={onClose}>
        {isNew ? 'Add workspace override' : 'Edit workspace override'}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Apply to workspaces'>
          <ChipDropdown
            multiple
            value={draft.workspaceIds}
            onChange={(workspaceIds) => onChange({ ...draft, workspaceIds })}
            options={workspaceOptions}
            placeholder='Select workspaces'
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Log retention'>
          <RetentionSelect
            allowInherit
            value={draft.logDays}
            onChange={(logDays) => onChange({ ...draft, logDays })}
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Soft deletion cleanup'>
          <RetentionSelect
            allowInherit
            value={draft.softDeleteDays}
            onChange={(softDeleteDays) => onChange({ ...draft, softDeleteDays })}
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Task cleanup'>
          <RetentionSelect
            allowInherit
            value={draft.taskCleanupDays}
            onChange={(taskCleanupDays) => onChange({ ...draft, taskCleanupDays })}
          />
        </ChipModalField>
        {piiEnabled && (
          <ChipModalField type='custom' title='PII redaction'>
            <div className='flex flex-col gap-3'>
              <ChipSwitch
                value={draft.piiMode}
                onChange={(piiMode) => onChange({ ...draft, piiMode })}
                aria-label='PII redaction override mode'
                options={[
                  { value: 'inherit', label: 'Inherit' },
                  { value: 'override', label: 'Override' },
                ]}
              />
              {draft.piiMode === 'override' && (
                <>
                  <EntityCheckboxGrid
                    selected={draft.piiEntityTypes}
                    onChange={(piiEntityTypes) => onChange({ ...draft, piiEntityTypes })}
                  />
                  <PiiLanguageSelect
                    value={draft.piiLanguage}
                    onChange={(piiLanguage) => onChange({ ...draft, piiLanguage })}
                  />
                </>
              )}
            </div>
          </ChipModalField>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: isSaving ? 'Saving...' : 'Save',
          onClick: onSave,
          disabled: isSaving || draft.workspaceIds.length === 0,
        }}
      />
    </ChipModal>
  )
}

export function DataRetentionSettings() {
  const { data: session, isPending: sessionPending } = useSession()
  const { data: orgsData, isLoading: orgsLoading } = useOrganizations()

  const activeOrganization = orgsData?.activeOrganization
  const orgId = activeOrganization?.id

  const { data, isLoading: retentionLoading } = useOrganizationRetention(orgId)
  const updateMutation = useUpdateOrganizationRetention()
  const { data: workspaces } = useWorkspacesQuery(Boolean(orgId))
  const workspaceOptions = (workspaces ?? [])
    .filter((w) => w.organizationId === orgId)
    .map((w) => ({ value: w.id, label: w.name }))
  const workspaceName = (id: string) =>
    workspaceOptions.find((w) => w.value === id)?.label ?? 'Unknown workspace'

  const userEmail = session?.user?.email
  const userRole = getUserRole(activeOrganization, userEmail)
  const canManage = isOrgAdminRole(userRole)
  const piiEnabled = Boolean(data?.piiRedactionEnabled)

  const [logDays, setLogDays] = useState('')
  const [softDeleteDays, setSoftDeleteDays] = useState('')
  const [taskCleanupDays, setTaskCleanupDays] = useState('')
  const [savedHours, setSavedHours] = useState('')
  const [defaultPii, setDefaultPii] = useState<DefaultPiiDraft | null>(null)
  const [piiOverrides, setPiiOverrides] = useState<
    { id: string; workspaceId: string; entityTypes: string[]; language: PIILanguage }[]
  >([])
  const [overrides, setOverrides] = useState<RetentionOverride[]>([])
  const [modal, setModal] = useState<ActiveModal | null>(null)
  const [showUnsaved, setShowUnsaved] = useState(false)
  // Org the form was hydrated for; re-hydrate when the active org switches so
  // saves don't target the new org with the previous org's config.
  const hydratedOrgRef = useRef<string | null>(null)

  function hoursSnapshot(log: string, soft: string, task: string): string {
    return JSON.stringify({ log, soft, task })
  }

  useEffect(() => {
    if (!data || !orgId || hydratedOrgRef.current === orgId) return
    const log = hoursToDisplayDays(data.effective.logRetentionHours)
    const soft = hoursToDisplayDays(data.effective.softDeleteRetentionHours)
    const task = hoursToDisplayDays(data.effective.taskCleanupHours)
    setLogDays(log)
    setSoftDeleteDays(soft)
    setTaskCleanupDays(task)
    setSavedHours(hoursSnapshot(log, soft, task))

    const rules = data.configured.piiRedaction?.rules ?? []
    const defaultRule = rules.find((r) => r.workspaceId === null)
    setDefaultPii(
      defaultRule
        ? {
            id: defaultRule.id,
            entityTypes: defaultRule.entityTypes,
            language: defaultRule.language ?? DEFAULT_PII_LANGUAGE,
          }
        : null
    )
    setPiiOverrides(
      rules
        .filter((r) => r.workspaceId !== null)
        .map((r) => ({
          id: r.id,
          workspaceId: r.workspaceId as string,
          entityTypes: r.entityTypes,
          language: r.language ?? DEFAULT_PII_LANGUAGE,
        }))
    )
    setOverrides(data.configured.retentionOverrides ?? [])
    hydratedOrgRef.current = orgId
  }, [data, orgId])

  const hoursChanged = hoursSnapshot(logDays, softDeleteDays, taskCleanupDays) !== savedHours

  const modalChanged =
    modal !== null &&
    (modal.kind === 'pii-default'
      ? normalizeDefaultPii(modal.draft) !== normalizeDefaultPii(modal.original)
      : normalizeWorkspaceDraft(modal.draft) !== normalizeWorkspaceDraft(modal.original))

  // PII-only rows are only surfaced when redaction is enabled — the route
  // rejects PII writes while the flag is off, so such rows couldn't be deleted.
  const overrideWorkspaceIds = Array.from(
    new Set([
      ...overrides.map((o) => o.workspaceId),
      ...(piiEnabled ? piiOverrides.map((p) => p.workspaceId) : []),
    ])
  ).sort((a, b) => workspaceName(a).localeCompare(workspaceName(b)))
  const takenWorkspaceIds = new Set(overrideWorkspaceIds)
  const freeWorkspaces = workspaceOptions.filter((w) => !takenWorkspaceIds.has(w.value))

  /** Options for the modal's workspace picker — excludes workspaces taken by OTHER overrides. */
  function workspaceModalOptions(
    draft: WorkspaceOverrideDraft
  ): { value: string; label: string }[] {
    const others = new Set(overrideWorkspaceIds.filter((id) => !draft.workspaceIds.includes(id)))
    return workspaceOptions.filter((w) => !others.has(w.value))
  }

  function overrideRowSummary(workspaceId: string): string {
    const ov = overrides.find((o) => o.workspaceId === workspaceId)
    const pii = piiOverrides.find((p) => p.workspaceId === workspaceId)
    const parts = [
      `Log ${retentionLabel(ov?.logRetentionHours)}`,
      `Soft-delete ${retentionLabel(ov?.softDeleteRetentionHours)}`,
      `Task ${retentionLabel(ov?.taskCleanupHours)}`,
    ]
    if (piiEnabled) parts.push(pii ? `PII: ${entitySummary(pii.entityTypes)}` : 'PII inherited')
    return parts.join(' · ')
  }

  /** Persist both PII rules and retention overrides in one PUT. */
  async function persistGovernance(
    nextDefaultPii: DefaultPiiDraft | null,
    nextPiiOverrides: typeof piiOverrides,
    nextOverrides: RetentionOverride[]
  ) {
    if (!orgId) return
    const settings: UpdateOrganizationDataRetentionBody = { retentionOverrides: nextOverrides }
    if (piiEnabled) {
      const rules: {
        id: string
        entityTypes: string[]
        workspaceId: string | null
        language: PIILanguage
      }[] = nextPiiOverrides.map((p) => ({
        id: p.id,
        entityTypes: p.entityTypes,
        workspaceId: p.workspaceId,
        language: p.language,
      }))
      if (nextDefaultPii) {
        rules.unshift({
          id: nextDefaultPii.id,
          entityTypes: nextDefaultPii.entityTypes,
          workspaceId: null,
          language: nextDefaultPii.language,
        })
      }
      settings.piiRedaction = { rules }
    }
    await updateMutation.mutateAsync({ orgId, settings })
    setOverrides(nextOverrides)
    if (piiEnabled) {
      setDefaultPii(nextDefaultPii)
      setPiiOverrides(nextPiiOverrides)
    }
  }

  function openEditDefault() {
    const draft: DefaultPiiDraft = defaultPii ?? {
      id: generateId(),
      entityTypes: [],
      language: DEFAULT_PII_LANGUAGE,
    }
    setModal({
      kind: 'pii-default',
      draft: { ...draft },
      original: draft,
      isNew: defaultPii === null,
    })
  }

  function openAddOverride() {
    if (freeWorkspaces.length === 0) return
    const draft: WorkspaceOverrideDraft = {
      workspaceIds: [],
      logDays: INHERIT,
      softDeleteDays: INHERIT,
      taskCleanupDays: INHERIT,
      piiMode: 'inherit',
      piiEntityTypes: [],
      piiLanguage: DEFAULT_PII_LANGUAGE,
    }
    setModal({ kind: 'workspace', draft, original: draft, isNew: true })
  }

  function openEditOverride(workspaceId: string) {
    const ov = overrides.find((o) => o.workspaceId === workspaceId)
    const pii = piiOverrides.find((p) => p.workspaceId === workspaceId)
    const draft: WorkspaceOverrideDraft = {
      workspaceIds: [workspaceId],
      logDays: hoursToOverrideValue(ov?.logRetentionHours),
      softDeleteDays: hoursToOverrideValue(ov?.softDeleteRetentionHours),
      taskCleanupDays: hoursToOverrideValue(ov?.taskCleanupHours),
      piiMode: pii ? 'override' : 'inherit',
      piiEntityTypes: pii?.entityTypes ?? [],
      piiLanguage: pii?.language ?? DEFAULT_PII_LANGUAGE,
    }
    setModal({ kind: 'workspace', draft, original: draft, isNew: false })
  }

  function clearModal() {
    setModal(null)
    setShowUnsaved(false)
  }

  function requestCloseModal() {
    if (modalChanged) {
      setShowUnsaved(true)
    } else {
      clearModal()
    }
  }

  async function saveModal() {
    if (!modal) return
    try {
      if (modal.kind === 'pii-default') {
        await persistGovernance(modal.draft, piiOverrides, overrides)
        clearModal()
        toast.success('PII redaction saved.')
        return
      }

      const ids = modal.draft.workspaceIds
      if (ids.length === 0) return
      const idSet = new Set(ids)
      const nextOverrides = overrides.filter((o) => !idSet.has(o.workspaceId))
      const nextPiiOverrides = piiOverrides.filter((p) => !idSet.has(p.workspaceId))
      for (const workspaceId of ids) {
        const ov = buildRetentionOverride(workspaceId, modal.draft)
        if (ov) nextOverrides.push(ov)
        if (piiEnabled && modal.draft.piiMode === 'override') {
          const existing = piiOverrides.find((p) => p.workspaceId === workspaceId)
          nextPiiOverrides.push({
            id: existing?.id ?? generateId(),
            workspaceId,
            entityTypes: modal.draft.piiEntityTypes,
            language: modal.draft.piiLanguage,
          })
        }
      }
      await persistGovernance(defaultPii, nextPiiOverrides, nextOverrides)
      clearModal()
      toast.success('Workspace overrides saved.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to save data retention governance', { error: msg })
      toast.error(msg)
    }
  }

  async function removeDefaultPii() {
    try {
      await persistGovernance(null, piiOverrides, overrides)
      toast.success('PII redaction updated.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to remove PII redaction', { error: msg })
      toast.error(msg)
    }
  }

  async function removeOverrideRow(workspaceId: string) {
    try {
      await persistGovernance(
        defaultPii,
        piiOverrides.filter((p) => p.workspaceId !== workspaceId),
        overrides.filter((o) => o.workspaceId !== workspaceId)
      )
      toast.success('Workspace override removed.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to remove workspace override', { error: msg })
      toast.error(msg)
    }
  }

  async function handleSaveHours() {
    if (!orgId) return
    try {
      await updateMutation.mutateAsync({
        orgId,
        settings: {
          logRetentionHours: daysToHours(logDays),
          softDeleteRetentionHours: daysToHours(softDeleteDays),
          taskCleanupHours: daysToHours(taskCleanupDays),
        },
      })
      setSavedHours(hoursSnapshot(logDays, softDeleteDays, taskCleanupDays))
      toast.success('Data retention settings saved.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to save data retention settings', { error: msg })
      toast.error(msg)
    }
  }

  if (sessionPending || orgsLoading || (orgId && retentionLoading)) {
    return null
  }

  if (!orgId) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Data retention is configured per organization. Join or create an organization to continue.
      </div>
    )
  }

  if (!data) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Failed to load data retention settings.
      </div>
    )
  }

  if (isBillingEnabled && !data.isEnterprise) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Data retention is available on Enterprise plans only.
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Only organization owners and admins can configure data retention settings.
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <div />
        <div className='flex items-center'>
          <Chip
            variant='primary'
            onClick={handleSaveHours}
            disabled={updateMutation.isPending || !hoursChanged}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Chip>
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-8 pt-6 pb-6'>
          <SettingsSection label='Default · all workspaces'>
            <div className='flex flex-col gap-5'>
              <SettingRow
                label='Log retention'
                description='How long execution logs are kept before they are permanently deleted.'
              >
                <RetentionSelect value={logDays} onChange={setLogDays} />
              </SettingRow>
              <SettingRow
                label='Soft deletion cleanup'
                description='How long deleted resources remain recoverable before they are permanently removed.'
              >
                <RetentionSelect value={softDeleteDays} onChange={setSoftDeleteDays} />
              </SettingRow>
              <SettingRow
                label='Task cleanup'
                description='How long copilot chats, runs, and inbox tasks are kept before they are permanently deleted.'
              >
                <RetentionSelect value={taskCleanupDays} onChange={setTaskCleanupDays} />
              </SettingRow>
              {piiEnabled && (
                <SettingRow
                  label='PII redaction'
                  description='Mask detected PII in workflow logs before they are persisted.'
                >
                  <div className='flex items-center gap-2'>
                    <span className='truncate text-[var(--text-body)] text-small'>
                      {defaultPii ? entitySummary(defaultPii.entityTypes) : 'Not redacted'}
                    </span>
                    <Chip onClick={openEditDefault}>{defaultPii ? 'Edit' : 'Configure'}</Chip>
                    {defaultPii && (
                      <Chip onClick={removeDefaultPii} disabled={updateMutation.isPending}>
                        Delete
                      </Chip>
                    )}
                  </div>
                </SettingRow>
              )}
            </div>
          </SettingsSection>
          <SettingsSection label='Workspace overrides'>
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-[var(--text-muted)] text-caption'>
                  Workspaces not listed inherit the organization defaults.
                </span>
                <Chip
                  leftIcon={Plus}
                  onClick={openAddOverride}
                  disabled={freeWorkspaces.length === 0}
                >
                  Add override
                </Chip>
              </div>
              {overrideWorkspaceIds.length === 0 ? (
                <p className='text-[var(--text-muted)] text-caption'>
                  No overrides — every workspace uses the defaults above.
                </p>
              ) : (
                <div className='flex flex-col gap-2'>
                  {overrideWorkspaceIds.map((workspaceId) => (
                    <div
                      key={workspaceId}
                      className='flex items-center justify-between gap-3 rounded-lg border border-[var(--border-1)] px-3 py-2'
                    >
                      <div className='flex min-w-0 flex-col'>
                        <span className='truncate text-[var(--text-body)] text-small'>
                          {workspaceName(workspaceId)}
                        </span>
                        <span className='truncate text-[var(--text-muted)] text-caption'>
                          {overrideRowSummary(workspaceId)}
                        </span>
                      </div>
                      <div className='flex flex-shrink-0 items-center gap-2'>
                        <Chip onClick={() => openEditOverride(workspaceId)}>Configure</Chip>
                        <Chip
                          onClick={() => removeOverrideRow(workspaceId)}
                          disabled={updateMutation.isPending}
                        >
                          Delete
                        </Chip>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsSection>
        </div>
      </div>
      {modal?.kind === 'pii-default' && (
        <DefaultPiiModal
          draft={modal.draft}
          isNew={modal.isNew}
          isSaving={updateMutation.isPending}
          onChange={(draft) => setModal({ ...modal, draft })}
          onClose={requestCloseModal}
          onSave={saveModal}
        />
      )}
      {modal?.kind === 'workspace' && (
        <WorkspaceOverrideModal
          draft={modal.draft}
          isNew={modal.isNew}
          isSaving={updateMutation.isPending}
          piiEnabled={piiEnabled}
          workspaceOptions={workspaceModalOptions(modal.draft)}
          onChange={(draft) => setModal({ ...modal, draft })}
          onClose={requestCloseModal}
          onSave={saveModal}
        />
      )}
      <ChipModal
        open={showUnsaved}
        onOpenChange={setShowUnsaved}
        size='sm'
        srTitle='Unsaved changes'
      >
        <ChipModalHeader onClose={() => setShowUnsaved(false)}>Unsaved changes</ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-muted)] text-small'>
            You have unsaved changes. Save them before closing?
          </p>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setShowUnsaved(false)}
          cancelDisabled={updateMutation.isPending}
          secondaryActions={[{ label: 'Discard', onClick: clearModal, variant: 'destructive' }]}
          primaryAction={{
            label: updateMutation.isPending ? 'Saving...' : 'Save',
            onClick: saveModal,
            disabled: updateMutation.isPending,
          }}
        />
      </ChipModal>
    </div>
  )
}
