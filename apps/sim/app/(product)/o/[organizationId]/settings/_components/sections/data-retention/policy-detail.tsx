'use client'

import { useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { FieldFrame, SelectField } from '@sim/emcn/field'
import { Input } from '@sim/emcn/field/inputs'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchField } from '@sim/emcn/search-field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { generateShortId } from '@sim/utils/id'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/data-retention/policy-detail.module.css'
import {
  customPatternError,
  getEntityGroupsForLanguage,
  MAX_CUSTOM_PII_PATTERNS,
  PII_LANGUAGES,
  PII_STAGE_META,
  type PIILanguage,
  type PiiStageKey,
  type PiiStagePolicy,
  type PolicyDraft,
  pruneEntitiesForLanguage,
  retentionSelectOptions,
  stageHasContent,
  updateStagePolicy,
} from '@/platform/lib/data/data-retention'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

function CustomPatternsEditor({
  patterns,
  onChange,
}: {
  patterns: NonNullable<PiiStagePolicy['customPatterns']>
  onChange: (patterns: NonNullable<PiiStagePolicy['customPatterns']>) => void
}) {
  const [keys, setKeys] = useState(() => patterns.map(() => generateShortId()))
  // A discard replaces the list from outside: re-key it, since no row survives as it was.
  if (keys.length !== patterns.length) setKeys(patterns.map(() => generateShortId()))
  const update = (index: number, patch: Partial<(typeof patterns)[number]>) =>
    onChange(patterns.map((pattern, i) => (i === index ? { ...pattern, ...patch } : pattern)))
  return (
    <>
      {patterns.map((pattern, index) => {
        const error = customPatternError(pattern.regex)
        return (
          <FieldFrame
            key={keys[index] ?? index}
            label={`Custom pattern ${index + 1}`}
            labelHidden
            error={error}
          >
            <div className={styles.pattern}>
              <Input
                label='Name'
                placeholder='Name'
                value={pattern.name}
                onChange={(name) => update(index, { name })}
              />
              <Input
                label='Pattern (regex)'
                placeholder='Pattern (regex)'
                spellCheck={false}
                invalid={Boolean(error)}
                value={pattern.regex}
                onChange={(regex) => update(index, { regex })}
              />
              <Input
                label='Substitution text'
                placeholder='SUBSTITUTION_TEXT'
                value={pattern.replacement}
                onChange={(replacement) => update(index, { replacement })}
              />
              <IconButton
                label='Remove pattern'
                icon='I105'
                onClick={() => {
                  setKeys(keys.filter((_, i) => i !== index))
                  onChange(patterns.filter((_, i) => i !== index))
                }}
              />
            </div>
          </FieldFrame>
        )
      })}
      <ActionRow>
        <Button
          size='compact'
          icon='I074'
          disabled={patterns.length >= MAX_CUSTOM_PII_PATTERNS}
          onClick={() => {
            setKeys([...keys, generateShortId()])
            onChange([...patterns, { name: '', regex: '', replacement: '' }])
          }}
        >
          Add pattern
        </Button>
      </ActionRow>
    </>
  )
}

interface StagePanelProps {
  stageKey: PiiStageKey
  description: string
  value: PiiStagePolicy
  onChange: (next: PiiStagePolicy) => void
}

/**
 * One redaction stage. It is "on" purely by having entity types or patterns selected, so there is no
 * separate toggle. Block outputs run in-flight on large payloads, so they offer no NER recognizers.
 */
function StagePanel({ stageKey, description, value, onChange }: StagePanelProps) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const update = (patch: Partial<PiiStagePolicy>) => onChange(updateStagePolicy(value, patch))
  const groups = getEntityGroupsForLanguage(value.language, {
    regexOnly: stageKey === 'blockOutputs',
  })
    .map((group) => ({
      label: group.label,
      entities: query
        ? group.entities.filter(
            (entity) =>
              entity.label.toLowerCase().includes(query) ||
              entity.value.toLowerCase().includes(query)
          )
        : group.entities,
    }))
    .filter((group) => group.entities.length > 0)
  const selected = value.entityTypes as string[]
  return (
    <FieldStack>
      <Muted>{description}</Muted>
      <Muted>
        Loose numeric recognizers (US Social Security Number, US bank account number) and Date or
        time match aggressively and frequently over-redact. Enable these only where false positives
        are acceptable
      </Muted>
      <SearchField
        label='Search PII types'
        placeholder='Search PII types…'
        onValueChange={setSearch}
      />
      <SelectField
        label='Language'
        options={PII_LANGUAGES}
        value={value.language}
        onValueChange={(next) => {
          const language = next as PIILanguage
          update({ language, entityTypes: pruneEntitiesForLanguage(selected, language) })
        }}
      />
      {groups.map((group) => (
        <div key={group.label} className={styles.group}>
          <Muted>{group.label}</Muted>
          <div className={styles.entities}>
            {group.entities.map((entity) => (
              <Checkbox
                key={entity.value}
                label={entity.label}
                checked={selected.includes(entity.value)}
                onCheckedChange={() =>
                  update({
                    entityTypes: selected.includes(entity.value)
                      ? selected.filter((type) => type !== entity.value)
                      : [...selected, entity.value],
                  })
                }
              />
            ))}
          </div>
        </div>
      ))}
      <CustomPatternsEditor
        patterns={value.customPatterns ?? []}
        onChange={(customPatterns) => update({ customPatterns })}
      />
    </FieldStack>
  )
}

interface PolicyDetailProps {
  /** The override's workspace as its row names it; the organization's policy needs none. */
  name: string
  draft: PolicyDraft
  isNew: boolean
  dirty: boolean
  isSaving: boolean
  workspaceOptions: { value: string; label: string }[]
  onChange: (draft: PolicyDraft) => void
  onBack: () => void
  onDiscard: () => void
  onSave: () => void
  onRemove: () => Promise<void>
}

const RETENTION_FIELDS = [
  { key: 'logDays', label: 'Log retention' },
  { key: 'softDeleteDays', label: 'Soft deletion cleanup' },
  { key: 'taskCleanupDays', label: 'Task cleanup' },
] as const

interface AddOverrideProps {
  dirty: boolean
  isSaving: boolean
  disabled: boolean
  onDiscard: () => void
  onSave: () => void
}

/** A new override's submit: Add override, with the draft held by the Settings leave guard. */
function AddOverride({ dirty, isSaving, disabled, onDiscard, onSave }: AddOverrideProps) {
  useSettingsUnsavedGuard({ isDirty: dirty, navigationBlocked: isSaving, onDiscard })
  return (
    <ActionRow>
      <Button variant='primary' disabled={disabled || isSaving} onClick={onSave}>
        {isSaving ? 'Adding…' : 'Add override'}
      </Button>
    </ActionRow>
  )
}

export function PolicyDetail({
  name,
  draft,
  isNew,
  dirty,
  isSaving,
  workspaceOptions,
  onChange,
  onBack,
  onDiscard,
  onSave,
  onRemove,
}: PolicyDetailProps) {
  const isOrg = draft.isOrgDefault
  const canRemove = !isOrg && !isNew
  const showPiiGrid = isOrg || draft.piiOverride
  const [activeStage, setActiveStage] = useState<PiiStageKey>(
    () =>
      PII_STAGE_META.find((stage) => stageHasContent(draft.piiStages[stage.key]))?.key ??
      PII_STAGE_META[0].key
  )
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const stageMeta = PII_STAGE_META.find((stage) => stage.key === activeStage) ?? PII_STAGE_META[0]
  const setStage = (next: PiiStagePolicy) =>
    onChange({ ...draft, piiStages: { ...draft.piiStages, [activeStage]: next } })

  return (
    <>
      <DetailHeader
        backLabel='Data retention'
        onBack={onBack}
        title={isOrg ? 'Organization defaults' : isNew ? 'Add workspace override' : name}
        description={
          isOrg
            ? 'Applied to every workspace without its own override'
            : 'Overrides the organization defaults for the selected workspaces'
        }
      />
      <FormFieldset disabled={isSaving}>
        {!isOrg && (
          <SettingsSection title='Workspaces'>
            <FieldStack>
              <MultiSelect
                label='Workspaces'
                labelHidden
                searchLabel='Search workspaces'
                placeholder='Select workspaces'
                options={workspaceOptions}
                value={draft.workspaceIds}
                onValueChange={(workspaceIds) => onChange({ ...draft, workspaceIds })}
              />
            </FieldStack>
            {canRemove && (
              <SettingsRow
                label='Remove override'
                description='Use the organization defaults for these workspaces'
              >
                <Button variant='quiet' destructive onClick={() => setConfirmingRemove(true)}>
                  Remove override
                </Button>
              </SettingsRow>
            )}
          </SettingsSection>
        )}
        <SettingsSection title='Retention'>
          <FieldStack>
            {RETENTION_FIELDS.map(({ key, label }) => (
              <SelectField
                key={key}
                label={label}
                options={retentionSelectOptions(draft[key], !isOrg)}
                value={draft[key]}
                onValueChange={(value) => onChange({ ...draft, [key]: value })}
              />
            ))}
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='PII redaction'>
          <FieldStack>
            {!isOrg && (
              <>
                <Muted>Inherit the organization defaults or set workspace-specific redaction</Muted>
                <SegmentedControl
                  label='PII redaction override mode'
                  options={[
                    { value: 'inherit', label: 'Inherit' },
                    { value: 'override', label: 'Override' },
                  ]}
                  value={draft.piiOverride ? 'override' : 'inherit'}
                  onSelect={(mode) => onChange({ ...draft, piiOverride: mode === 'override' })}
                />
              </>
            )}
            {!isOrg && draft.piiOverride && (
              <Muted>Overriding replaces all three redaction stages for this workspace</Muted>
            )}
            {showPiiGrid && (
              <>
                <SegmentedControl
                  label='Redaction stage'
                  options={PII_STAGE_META.map((stage) => ({
                    value: stage.key,
                    label: stage.label,
                  }))}
                  value={activeStage}
                  onSelect={setActiveStage}
                />
                <ActionRow>
                  <Button
                    size='compact'
                    disabled={draft.piiStages[activeStage].entityTypes.length === 0}
                    onClick={() =>
                      // Clearing entity types leaves custom patterns, so the stage may stay on.
                      setStage(updateStagePolicy(draft.piiStages[activeStage], { entityTypes: [] }))
                    }
                  >
                    Deselect all
                  </Button>
                </ActionRow>
                <StagePanel
                  key={activeStage}
                  stageKey={activeStage}
                  description={stageMeta.description}
                  value={draft.piiStages[activeStage]}
                  onChange={setStage}
                />
              </>
            )}
          </FieldStack>
        </SettingsSection>
      </FormFieldset>
      {isNew ? (
        <AddOverride
          dirty={dirty}
          isSaving={isSaving}
          disabled={draft.workspaceIds.length === 0}
          onDiscard={onDiscard}
          onSave={onSave}
        />
      ) : (
        <SettingsSaveBar
          dirty={dirty}
          saving={isSaving}
          blockedReason={
            !isOrg && draft.workspaceIds.length === 0 ? 'Select at least one workspace' : undefined
          }
          onSave={onSave}
          onDiscard={onDiscard}
        />
      )}
      <ConfirmDialog
        target={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title={`Remove override for ${name}`}
        description='These workspaces fall back to the organization’s retention and PII redaction defaults'
        confirmLabel='Remove override'
        pendingLabel='Removing…'
        onConfirm={onRemove}
      />
    </>
  )
}
