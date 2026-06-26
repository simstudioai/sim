'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { ArrowRight, Plus } from 'lucide-react'
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
  ChipTag,
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
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
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

interface PiiOverride {
  id: string
  workspaceId: string
  entityTypes: string[]
  language: PIILanguage
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
  workspaceIds: string[]
  logDays: string
  softDeleteDays: string
  taskCleanupDays: string
  piiOverride: boolean
  piiEntityTypes: string[]
  piiLanguage: PIILanguage
}

interface ActiveModal {
  draft: PolicyDraft
  original: PolicyDraft
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

function buildRetentionOverride(workspaceId: string, draft: PolicyDraft): RetentionOverride | null {
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

function normalizePolicyDraft(draft: PolicyDraft): string {
  return JSON.stringify({
    isOrgDefault: draft.isOrgDefault,
    workspaceIds: [...draft.workspaceIds].sort(),
    logDays: draft.logDays,
    softDeleteDays: draft.softDeleteDays,
    taskCleanupDays: draft.taskCleanupDays,
    piiOverride: draft.piiOverride,
    piiEntityTypes: draft.piiOverride ? [...draft.piiEntityTypes].sort() : [],
    piiLanguage: draft.piiLanguage,
  })
}

function entitySummary(entityTypes: string[]): string {
  if (entityTypes.length === 0) return 'Not redacted'
  const labels = entityTypes.map((t) => ENTITY_LABELS[t] ?? t)
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
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

interface PolicyModalProps {
  draft: PolicyDraft
  isNew: boolean
  isSaving: boolean
  piiEnabled: boolean
  canRemove: boolean
  workspaceOptions: { value: string; label: string }[]
  onChange: (draft: PolicyDraft) => void
  onClose: () => void
  onSave: () => void
  onRemove: () => void
}

function PolicyModal({
  draft,
  isNew,
  isSaving,
  piiEnabled,
  canRemove,
  workspaceOptions,
  onChange,
  onClose,
  onSave,
  onRemove,
}: PolicyModalProps) {
  const isOrg = draft.isOrgDefault
  const showPiiGrid = isOrg || draft.piiOverride

  return (
    <ChipModal open onOpenChange={onClose} size='xl' srTitle='Retention policy'>
      <ChipModalHeader onClose={onClose}>
        {isOrg
          ? 'Organization defaults'
          : isNew
            ? 'Add workspace override'
            : 'Edit workspace override'}
      </ChipModalHeader>
      <ChipModalBody>
        {!isOrg && (
          <ChipModalField type='custom' title='Apply to workspaces'>
            <ChipDropdown
              multiple
              value={draft.workspaceIds}
              onChange={(workspaceIds) => onChange({ ...draft, workspaceIds })}
              options={workspaceOptions}
              placeholder='Select workspaces'
            />
          </ChipModalField>
        )}
        <ChipModalField type='custom' title='Log retention'>
          <RetentionSelect
            allowInherit={!isOrg}
            value={draft.logDays}
            onChange={(logDays) => onChange({ ...draft, logDays })}
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Soft deletion cleanup'>
          <RetentionSelect
            allowInherit={!isOrg}
            value={draft.softDeleteDays}
            onChange={(softDeleteDays) => onChange({ ...draft, softDeleteDays })}
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Task cleanup'>
          <RetentionSelect
            allowInherit={!isOrg}
            value={draft.taskCleanupDays}
            onChange={(taskCleanupDays) => onChange({ ...draft, taskCleanupDays })}
          />
        </ChipModalField>
        {piiEnabled && (
          <ChipModalField type='custom' title='PII redaction'>
            <div className='flex flex-col gap-3'>
              {!isOrg && (
                <ChipSwitch
                  value={draft.piiOverride ? 'override' : 'inherit'}
                  onChange={(mode) => onChange({ ...draft, piiOverride: mode === 'override' })}
                  aria-label='PII redaction override mode'
                  options={[
                    { value: 'inherit', label: 'Inherit' },
                    { value: 'override', label: 'Override' },
                  ]}
                />
              )}
              {showPiiGrid && (
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
        secondaryActions={
          canRemove
            ? [{ label: 'Remove override', onClick: onRemove, variant: 'destructive' }]
            : undefined
        }
        primaryAction={{
          label: isSaving ? 'Saving...' : 'Save',
          onClick: onSave,
          disabled: isSaving || (!isOrg && draft.workspaceIds.length === 0),
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
  const [defaultPii, setDefaultPii] = useState<Omit<PiiOverride, 'workspaceId'> | null>(null)
  const [piiOverrides, setPiiOverrides] = useState<PiiOverride[]>([])
  const [overrides, setOverrides] = useState<RetentionOverride[]>([])
  const [modal, setModal] = useState<ActiveModal | null>(null)
  const [showUnsaved, setShowUnsaved] = useState(false)
  // Org the form was hydrated for; re-hydrate when the active org switches so
  // saves don't target the new org with the previous org's config.
  const hydratedOrgRef = useRef<string | null>(null)

  useEffect(() => {
    if (!data || !orgId || hydratedOrgRef.current === orgId) return
    setLogDays(hoursToDisplayDays(data.effective.logRetentionHours))
    setSoftDeleteDays(hoursToDisplayDays(data.effective.softDeleteRetentionHours))
    setTaskCleanupDays(hoursToDisplayDays(data.effective.taskCleanupHours))

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

  const modalChanged =
    modal !== null && normalizePolicyDraft(modal.draft) !== normalizePolicyDraft(modal.original)

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
  function workspaceModalOptions(draft: PolicyDraft): { value: string; label: string }[] {
    const others = new Set(overrideWorkspaceIds.filter((id) => !draft.workspaceIds.includes(id)))
    return workspaceOptions.filter((w) => !others.has(w.value))
  }

  function orgRowSummary(): string {
    const parts = [
      `Log ${dayValueLabel(logDays)}`,
      `Soft-delete ${dayValueLabel(softDeleteDays)}`,
      `Task ${dayValueLabel(taskCleanupDays)}`,
    ]
    if (piiEnabled) {
      parts.push(
        defaultPii?.entityTypes.length ? `PII: ${entitySummary(defaultPii.entityTypes)}` : 'No PII'
      )
    }
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
    if (piiEnabled) parts.push(pii ? `PII: ${entitySummary(pii.entityTypes)}` : 'PII inherited')
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
  }) {
    if (!orgId) return
    const settings: UpdateOrganizationDataRetentionBody = {
      logRetentionHours: daysToHours(next.logDays),
      softDeleteRetentionHours: daysToHours(next.softDeleteDays),
      taskCleanupHours: daysToHours(next.taskCleanupDays),
      retentionOverrides: next.overrides,
    }
    if (piiEnabled) {
      const rules: {
        id: string
        entityTypes: string[]
        workspaceId: string | null
        language: PIILanguage
      }[] = next.piiOverrides.map((p) => ({
        id: p.id,
        entityTypes: p.entityTypes,
        workspaceId: p.workspaceId,
        language: p.language,
      }))
      if (next.defaultPii) {
        rules.unshift({
          id: next.defaultPii.id,
          entityTypes: next.defaultPii.entityTypes,
          workspaceId: null,
          language: next.defaultPii.language,
        })
      }
      settings.piiRedaction = { rules }
    }
    await updateMutation.mutateAsync({ orgId, settings })
    setLogDays(next.logDays)
    setSoftDeleteDays(next.softDeleteDays)
    setTaskCleanupDays(next.taskCleanupDays)
    setOverrides(next.overrides)
    if (piiEnabled) {
      setDefaultPii(next.defaultPii)
      setPiiOverrides(next.piiOverrides)
    }
  }

  function snapshot() {
    return { logDays, softDeleteDays, taskCleanupDays, defaultPii, piiOverrides, overrides }
  }

  function openEditOrg() {
    const draft: PolicyDraft = {
      isOrgDefault: true,
      workspaceIds: [],
      logDays,
      softDeleteDays,
      taskCleanupDays,
      piiOverride: true,
      piiEntityTypes: defaultPii?.entityTypes ?? [],
      piiLanguage: defaultPii?.language ?? DEFAULT_PII_LANGUAGE,
    }
    setModal({ draft, original: draft, isNew: false })
  }

  function openAddOverride() {
    if (freeWorkspaces.length === 0) return
    const draft: PolicyDraft = {
      isOrgDefault: false,
      workspaceIds: [],
      logDays: INHERIT,
      softDeleteDays: INHERIT,
      taskCleanupDays: INHERIT,
      piiOverride: false,
      piiEntityTypes: [],
      piiLanguage: DEFAULT_PII_LANGUAGE,
    }
    setModal({ draft, original: draft, isNew: true })
  }

  function openEditOverride(workspaceId: string) {
    const ov = overrides.find((o) => o.workspaceId === workspaceId)
    const pii = piiOverrides.find((p) => p.workspaceId === workspaceId)
    const draft: PolicyDraft = {
      isOrgDefault: false,
      workspaceIds: [workspaceId],
      logDays: hoursToOverrideValue(ov?.logRetentionHours),
      softDeleteDays: hoursToOverrideValue(ov?.softDeleteRetentionHours),
      taskCleanupDays: hoursToOverrideValue(ov?.taskCleanupHours),
      piiOverride: Boolean(pii),
      piiEntityTypes: pii?.entityTypes ?? [],
      piiLanguage: pii?.language ?? DEFAULT_PII_LANGUAGE,
    }
    setModal({ draft, original: draft, isNew: false })
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
    const draft = modal.draft
    try {
      if (draft.isOrgDefault) {
        await persistSnapshot({
          ...snapshot(),
          logDays: draft.logDays,
          softDeleteDays: draft.softDeleteDays,
          taskCleanupDays: draft.taskCleanupDays,
          defaultPii: draft.piiEntityTypes.length
            ? {
                id: defaultPii?.id ?? generateId(),
                entityTypes: draft.piiEntityTypes,
                language: draft.piiLanguage,
              }
            : null,
        })
        clearModal()
        toast.success('Organization defaults saved.')
        return
      }

      const ids = draft.workspaceIds
      if (ids.length === 0) return
      // Clear the workspaces this edit previously owned plus the new selection,
      // so deselecting a workspace removes its override instead of orphaning it.
      const clearIds = new Set([...modal.original.workspaceIds, ...ids])
      const nextOverrides = overrides.filter((o) => !clearIds.has(o.workspaceId))
      const nextPiiOverrides = piiOverrides.filter((p) => !clearIds.has(p.workspaceId))
      for (const workspaceId of ids) {
        const ov = buildRetentionOverride(workspaceId, draft)
        if (ov) nextOverrides.push(ov)
        if (piiEnabled && draft.piiOverride) {
          const existing = piiOverrides.find((p) => p.workspaceId === workspaceId)
          nextPiiOverrides.push({
            id: existing?.id ?? generateId(),
            workspaceId,
            entityTypes: draft.piiEntityTypes,
            language: draft.piiLanguage,
          })
        }
      }
      await persistSnapshot({
        ...snapshot(),
        overrides: nextOverrides,
        piiOverrides: nextPiiOverrides,
      })
      clearModal()
      toast.success('Workspace override saved.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to save data retention policy', { error: msg })
      toast.error(msg)
    }
  }

  async function removeCurrentOverride() {
    if (!modal || modal.draft.isOrgDefault) return
    // Remove the override(s) this row originally owned, regardless of any
    // unsaved changes to the workspace multi-select in the open modal.
    const idSet = new Set(modal.original.workspaceIds)
    try {
      await persistSnapshot({
        ...snapshot(),
        overrides: overrides.filter((o) => !idSet.has(o.workspaceId)),
        piiOverrides: piiOverrides.filter((p) => !idSet.has(p.workspaceId)),
      })
      clearModal()
      toast.success('Workspace override removed.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to remove workspace override', { error: msg })
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
    <>
      <SettingsPanel
        actions={
          <Chip
            leftIcon={Plus}
            variant='primary'
            onClick={openAddOverride}
            disabled={freeWorkspaces.length === 0}
          >
            Add override
          </Chip>
        }
      >
        <SettingsSection label='Retention policies'>
          <div className='flex flex-col gap-2'>
            <span className='text-[var(--text-muted)] text-caption'>
              Workspaces without an override inherit the organization defaults.
            </span>
            <div className='-mx-2 flex flex-col gap-y-0.5'>
              <button
                type='button'
                onClick={openEditOrg}
                className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
              >
                <div className='flex min-w-0 flex-1 flex-col'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate text-[14px] text-[var(--text-body)]'>
                      Organization
                    </span>
                    <ChipTag variant='gray' className='flex-shrink-0'>
                      Default
                    </ChipTag>
                  </div>
                  <span className='truncate text-[12px] text-[var(--text-muted)]'>
                    {orgRowSummary()}
                  </span>
                </div>
                <ArrowRight className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              </button>
              {overrideWorkspaceIds.map((workspaceId) => (
                <button
                  key={workspaceId}
                  type='button'
                  onClick={() => openEditOverride(workspaceId)}
                  className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                >
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate text-[14px] text-[var(--text-body)]'>
                      {workspaceName(workspaceId)}
                    </span>
                    <span className='truncate text-[12px] text-[var(--text-muted)]'>
                      {overrideRowSummary(workspaceId)}
                    </span>
                  </div>
                  <ArrowRight className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>
      </SettingsPanel>
      {modal && (
        <PolicyModal
          draft={modal.draft}
          isNew={modal.isNew}
          isSaving={updateMutation.isPending}
          piiEnabled={piiEnabled}
          canRemove={!modal.draft.isOrgDefault && !modal.isNew}
          workspaceOptions={workspaceModalOptions(modal.draft)}
          onChange={(draft) => setModal({ ...modal, draft })}
          onClose={requestCloseModal}
          onSave={saveModal}
          onRemove={removeCurrentOverride}
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
    </>
  )
}
