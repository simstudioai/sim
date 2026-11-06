'use client'

import { useState } from 'react'
import { customPatternError, MAX_CUSTOM_PII_PATTERNS } from '@/lib/guardrails/custom-patterns'
import {
  getEntityGroupsForLanguage,
  PII_LANGUAGES,
  PII_STAGE_META,
  type PIILanguage,
  type PiiStageKey,
  type PiiStagePolicy,
} from '@/lib/guardrails/pii-entities'
import {
  type PolicyDraft,
  pruneEntitiesForLanguage,
  retentionSelectOptions,
  stageHasContent,
  updateStagePolicy,
} from '@/ee/data-retention/lib/policy-draft'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/app/(shell)/settings/_components/sections/data-retention/policy-detail.module.css'
import {
  Button,
  Checkbox,
  ConfirmDialog,
  FieldFrame,
  IconButton,
  Input,
  MultiSelect,
  SaveActions,
  SectionSearch,
  SegmentedControl,
  SelectField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { plural } from '@/platform/lib/plural'

function CustomPatternsEditor({
  patterns,
  onChange,
}: {
  patterns: NonNullable<PiiStagePolicy['customPatterns']>
  onChange: (patterns: NonNullable<PiiStagePolicy['customPatterns']>) => void
}) {
  const update = (index: number, patch: Partial<(typeof patterns)[number]>) =>
    onChange(patterns.map((pattern, i) => (i === index ? { ...pattern, ...patch } : pattern)))
  return (
    <>
      {patterns.map((pattern, index) => {
        const error = customPatternError(pattern.regex)
        return (
          <FieldFrame key={index} label={`Custom pattern ${index + 1}`} labelHidden error={error}>
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
                onClick={() => onChange(patterns.filter((_, i) => i !== index))}
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
          onClick={() => onChange([...patterns, { name: '', regex: '', replacement: '' }])}
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
  /** Held above the stages, so the term survives switching between them. */
  search: string
  onSearchChange: (search: string) => void
}

/**
 * One redaction stage. It is "on" purely by having entity types or patterns selected, so there is no
 * separate toggle. Block outputs run in-flight on large payloads, so they offer no NER recognizers.
 */
function StagePanel({
  stageKey,
  description,
  value,
  onChange,
  search,
  onSearchChange,
}: StagePanelProps) {
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
        are acceptable.
      </Muted>
      <SectionSearch subject='PII types' value={search} onValueChange={onSearchChange} />
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
      <Muted>
        Custom patterns redact anything a regular expression can match (employee ids, internal urls,
        ticket numbers). Each match is replaced with its replacement text, wrapped in angle brackets
        (e.g. EMPLOYEE_ID → &lt;EMPLOYEE_ID&gt;).
      </Muted>
      <CustomPatternsEditor
        patterns={value.customPatterns ?? []}
        onChange={(customPatterns) => update({ customPatterns })}
      />
    </FieldStack>
  )
}

interface PolicyDetailProps {
  draft: PolicyDraft
  isNew: boolean
  changed: boolean
  /** A newer version is waiting on the editor's choice, so nothing can be saved yet. */
  conflict?: boolean
  isSaving: boolean
  canRemove: boolean
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

export function PolicyDetail({
  draft,
  isNew,
  changed,
  conflict,
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
  const [piiSearch, setPiiSearch] = useState('')
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
        title={
          isOrg
            ? 'Organization defaults'
            : isNew
              ? 'Add workspace override'
              : 'Edit workspace override'
        }
        description={
          isOrg
            ? 'Applied to every workspace without its own override.'
            : 'Overrides the organization defaults for the selected workspaces.'
        }
      />
      <FormFieldset disabled={isSaving}>
        {!isOrg && (
          <SettingsSection title='Workspaces'>
            <FieldStack>
              <MultiSelect
                label={
                  draft.workspaceIds.length > 0
                    ? `Overrides ${plural(draft.workspaceIds.length, 'workspace')}`
                    : 'Select the workspaces this override applies to'
                }
                searchLabel='Search workspaces'
                placeholder='Select workspaces'
                options={workspaceOptions}
                value={draft.workspaceIds}
                onValueChange={(workspaceIds) => onChange({ ...draft, workspaceIds })}
              />
            </FieldStack>
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
              <Muted>Overriding replaces all three redaction stages for this workspace.</Muted>
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
                  search={piiSearch}
                  onSearchChange={setPiiSearch}
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
      <SaveActions
        dirty={changed}
        saving={isSaving}
        blocked={conflict || (!isOrg && draft.workspaceIds.length === 0)}
        onSave={onSave}
        onDiscard={onDiscard}
      />
      {canRemove && (
        <SettingsSection title='Manage'>
          <SettingsRow
            label='Workspace override'
            description='Use the organization defaults for these workspaces.'
          >
            <Button
              variant='destructive'
              disabled={isSaving}
              onClick={() => setConfirmingRemove(true)}
            >
              Remove override
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      <ConfirmDialog
        target={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title='Remove override'
        description={`This removes the retention and PII redaction override for ${
          draft.workspaceIds.length === 1
            ? 'this workspace'
            : `these ${draft.workspaceIds.length} workspaces`
        }. They will fall back to the organization defaults.`}
        confirmLabel='Remove override'
        pendingLabel='Removing…'
        onConfirm={onRemove}
      />
    </>
  )
}
