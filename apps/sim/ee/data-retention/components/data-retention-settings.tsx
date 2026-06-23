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
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  Search,
  toast,
} from '@/components/emcn'
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
import { InfoNote } from '@/ee/components/info-note'
import { SettingRow } from '@/ee/components/setting-row'
import {
  useOrganizationRetention,
  useUpdateOrganizationRetention,
} from '@/ee/data-retention/hooks/data-retention'
import { useOrganizations } from '@/hooks/queries/organization'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

const logger = createLogger('DataRetentionSettings')

const ENTITY_LABELS = SUPPORTED_PII_ENTITIES as Record<string, string>

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

/**
 * Local editable shape of a PII redaction rule. `workspaceId: null` is the
 * all-workspaces default; a non-null id is a per-workspace override of it.
 */
interface RuleDraft {
  id: string
  entityTypes: string[]
  workspaceId: string | null
  language: PIILanguage
}

function hoursToDisplayDays(hours: number | null): string {
  if (hours === null) return 'never'
  return String(Math.round(hours / 24))
}

function daysToHours(days: string): number | null {
  if (days === 'never') return null
  return Number(days) * 24
}

function normalizeRule(rule: RuleDraft): string {
  return JSON.stringify({
    entityTypes: [...rule.entityTypes].sort(),
    workspaceId: rule.workspaceId,
    language: rule.language,
  })
}

function entitySummary(entityTypes: string[]): string {
  if (entityTypes.length === 0) return 'Not redacted'
  const labels = entityTypes.map((t) => ENTITY_LABELS[t] ?? t)
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
}

interface RetentionSelectProps {
  value: string
  onChange: (value: string) => void
}

function RetentionSelect({ value, onChange }: RetentionSelectProps) {
  const standard = DAY_OPTIONS.find((o) => o.value === value)
  const options = standard
    ? DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
    : [
        ...DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
        { value, label: `${value} days (custom)` },
      ]

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

interface RuleModalProps {
  draft: RuleDraft
  isNew: boolean
  isSaving: boolean
  /** Workspaces selectable for an override (excludes those taken by other overrides). */
  workspaceOptions: { value: string; label: string }[]
  onChange: (draft: RuleDraft) => void
  onClose: () => void
  onSave: () => void
}

function RuleModal({
  draft,
  isNew,
  isSaving,
  workspaceOptions,
  onChange,
  onClose,
  onSave,
}: RuleModalProps) {
  const isDefault = draft.workspaceId === null
  return (
    <ChipModal open onOpenChange={onClose} size='xl' srTitle='PII redaction'>
      <ChipModalHeader onClose={onClose}>
        {isDefault
          ? 'Default redaction · all workspaces'
          : isNew
            ? 'Add workspace override'
            : 'Edit workspace override'}
      </ChipModalHeader>
      <ChipModalBody>
        {!isDefault && (
          <ChipModalField type='custom' title='Workspace'>
            <ChipSelect
              value={draft.workspaceId ?? ''}
              onChange={(value) => onChange({ ...draft, workspaceId: value })}
              options={workspaceOptions}
              align='start'
            />
          </ChipModalField>
        )}
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
          <ChipSelect
            value={draft.language}
            onChange={(language) => onChange({ ...draft, language: language as PIILanguage })}
            options={PII_LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
            align='start'
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

  const [logDays, setLogDays] = useState('')
  const [softDeleteDays, setSoftDeleteDays] = useState('')
  const [taskCleanupDays, setTaskCleanupDays] = useState('')
  const [savedHours, setSavedHours] = useState('')
  const [rules, setRules] = useState<RuleDraft[]>([])
  const [modalDraft, setModalDraft] = useState<RuleDraft | null>(null)
  const [modalOriginal, setModalOriginal] = useState<RuleDraft | null>(null)
  const [modalIsNew, setModalIsNew] = useState(false)
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
    setRules(
      (data.configured.piiRedaction?.rules ?? []).map((r) => ({
        id: r.id,
        entityTypes: r.entityTypes,
        workspaceId: r.workspaceId,
        language: r.language ?? DEFAULT_PII_LANGUAGE,
      }))
    )
    hydratedOrgRef.current = orgId
  }, [data, orgId])

  const hoursChanged = hoursSnapshot(logDays, softDeleteDays, taskCleanupDays) !== savedHours
  const modalChanged =
    modalDraft !== null &&
    modalOriginal !== null &&
    normalizeRule(modalDraft) !== normalizeRule(modalOriginal)

  const defaultRule = rules.find((r) => r.workspaceId === null) ?? null
  const overrideRules = rules.filter((r) => r.workspaceId !== null)
  const takenWorkspaceIds = new Set(overrideRules.map((r) => r.workspaceId as string))
  const freeWorkspaces = workspaceOptions.filter((w) => !takenWorkspaceIds.has(w.value))

  /** Workspaces selectable for `draft` — excludes workspaces taken by OTHER overrides. */
  function overrideOptionsForDraft(draft: RuleDraft): { value: string; label: string }[] {
    const otherTaken = new Set(
      rules
        .filter((r) => r.id !== draft.id && r.workspaceId !== null)
        .map((r) => r.workspaceId as string)
    )
    return workspaceOptions.filter((w) => !otherTaken.has(w.value))
  }

  async function persistRules(nextRules: RuleDraft[]) {
    if (!orgId) return
    await updateMutation.mutateAsync({
      orgId,
      settings: {
        piiRedaction: {
          rules: nextRules.map((r) => ({
            id: r.id,
            entityTypes: r.entityTypes,
            workspaceId: r.workspaceId,
            language: r.language,
          })),
        },
      },
    })
    setRules(nextRules)
  }

  function openEditDefault() {
    const rule: RuleDraft = defaultRule ?? {
      id: generateId(),
      entityTypes: [],
      workspaceId: null,
      language: DEFAULT_PII_LANGUAGE,
    }
    setModalIsNew(defaultRule === null)
    setModalOriginal(rule)
    setModalDraft({ ...rule })
  }

  function openAddOverride() {
    const workspaceId = freeWorkspaces[0]?.value
    if (!workspaceId) return
    const blank: RuleDraft = {
      id: generateId(),
      entityTypes: [],
      workspaceId,
      language: DEFAULT_PII_LANGUAGE,
    }
    setModalIsNew(true)
    setModalOriginal(blank)
    setModalDraft(blank)
  }

  function openEditOverride(rule: RuleDraft) {
    setModalIsNew(false)
    setModalOriginal(rule)
    setModalDraft({ ...rule })
  }

  function clearModal() {
    setModalDraft(null)
    setModalOriginal(null)
    setShowUnsaved(false)
  }

  function requestCloseModal() {
    if (modalChanged) {
      setShowUnsaved(true)
    } else {
      clearModal()
    }
  }

  async function saveModalRule() {
    if (!modalDraft) return
    const next = rules.some((r) => r.id === modalDraft.id)
      ? rules.map((r) => (r.id === modalDraft.id ? modalDraft : r))
      : [...rules, modalDraft]
    try {
      await persistRules(next)
      clearModal()
      toast.success('PII redaction saved.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to save PII redaction', { error: msg })
      toast.error(msg)
    }
  }

  async function removeRule(id: string) {
    try {
      await persistRules(rules.filter((r) => r.id !== id))
      toast.success('PII redaction updated.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to update PII redaction', { error: msg })
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
          <InfoNote>Applies organization-wide</InfoNote>
          <SettingsSection label='Data Retention'>
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
            </div>
          </SettingsSection>
          {data?.piiRedactionEnabled && (
            <SettingsSection label='PII Redaction'>
              <div className='flex flex-col gap-6'>
                <div className='flex flex-col gap-2'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='font-medium text-[var(--text-muted)] text-small'>
                      Default · all workspaces
                    </span>
                    {!defaultRule && (
                      <Chip leftIcon={Plus} onClick={openEditDefault}>
                        Add redaction
                      </Chip>
                    )}
                  </div>
                  {defaultRule && (
                    <div className='flex items-center justify-between gap-3 rounded-lg border border-[var(--border-1)] px-3 py-2'>
                      <span className='truncate text-[var(--text-body)] text-small'>
                        {entitySummary(defaultRule.entityTypes)}
                      </span>
                      <div className='flex flex-shrink-0 items-center gap-2'>
                        <Chip onClick={openEditDefault}>Edit</Chip>
                        <Chip
                          onClick={() => removeRule(defaultRule.id)}
                          disabled={updateMutation.isPending}
                        >
                          Delete
                        </Chip>
                      </div>
                    </div>
                  )}
                </div>
                {defaultRule && (
                  <div className='flex flex-col gap-2'>
                    <div className='flex items-center justify-between gap-3'>
                      <span className='font-medium text-[var(--text-muted)] text-small'>
                        Workspace overrides
                      </span>
                      <Chip
                        leftIcon={Plus}
                        onClick={openAddOverride}
                        disabled={freeWorkspaces.length === 0}
                      >
                        Add override
                      </Chip>
                    </div>
                    {overrideRules.length === 0 ? (
                      <p className='text-[var(--text-muted)] text-caption'>
                        No overrides — every workspace uses the default.
                      </p>
                    ) : (
                      <div className='flex flex-col gap-2'>
                        {overrideRules.map((rule) => (
                          <div
                            key={rule.id}
                            className='flex items-center justify-between gap-3 rounded-lg border border-[var(--border-1)] px-3 py-2'
                          >
                            <div className='flex min-w-0 flex-col'>
                              <span className='truncate text-[var(--text-body)] text-small'>
                                {workspaceName(rule.workspaceId as string)}
                              </span>
                              <span className='truncate text-[var(--text-muted)] text-caption'>
                                {entitySummary(rule.entityTypes)}
                              </span>
                            </div>
                            <div className='flex flex-shrink-0 items-center gap-2'>
                              <Chip onClick={() => openEditOverride(rule)}>Edit</Chip>
                              <Chip
                                onClick={() => removeRule(rule.id)}
                                disabled={updateMutation.isPending}
                              >
                                Delete
                              </Chip>
                            </div>
                          </div>
                        ))}
                        <span className='text-[var(--text-muted)] text-caption'>
                          Workspaces not listed use the default.
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SettingsSection>
          )}
        </div>
      </div>
      {modalDraft && (
        <RuleModal
          draft={modalDraft}
          isNew={modalIsNew}
          isSaving={updateMutation.isPending}
          workspaceOptions={overrideOptionsForDraft(modalDraft)}
          onChange={setModalDraft}
          onClose={requestCloseModal}
          onSave={saveModalRule}
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
            onClick: saveModalRule,
            disabled: updateMutation.isPending,
          }}
        />
      </ChipModal>
    </div>
  )
}
