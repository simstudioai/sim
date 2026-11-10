'use client'

import type { ComponentType } from 'react'
import { IconButton } from '@sim/emcn/button'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { RuleCard } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/model-fallback-list/model-fallback-list.module.css'
import {
  FALLBACK_TUNING_LABELS,
  type FallbackModelEntry,
  type FallbackModelOption,
  type FallbackTuningKnob,
  isWholeEnvVarReference,
  ordinalChoiceLabel,
  type SecretReferenceOption,
} from '@/platform/lib/data/workflow-editor/builders'

const EMPTY_FIELD = {}

/** A tuning knob the row must ask about, with the values its model accepts. */
export interface FallbackTuningField {
  knob: FallbackTuningKnob
  options: { value: string; label: string }[]
}

/** Props for {@link FallbackRow}. */
interface FallbackRowProps {
  row: FallbackModelEntry
  index: number
  /** The row can move down only while another follows it. */
  isLast: boolean
  /** Move actions show only once a second row exists. */
  canMove: boolean
  /** The block's own key field cannot serve this row's model, so it names a secret. */
  needsApiKey: boolean
  tuningFields: FallbackTuningField[]
  modelOptions: FallbackModelOption[]
  /** Models any row holds; the row's own model stays selectable. */
  takenModels: ReadonlySet<string>
  secretOptions: SecretReferenceOption[]
  readOnly: boolean
  onChangeModel: (id: string, model: string) => void
  onChangeApiKey: (id: string, apiKey: string) => void
  onChangeTuning: (id: string, knob: FallbackTuningKnob, value: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
  onCreateSecret: () => void
}

interface ModelMarkProps {
  icon: ComponentType<{ className?: string }>
}

/** A provider's mark beside a model's name, sized to the row's glyphs. */
function ModelMark({ icon: Mark }: ModelMarkProps) {
  return (
    <span className={styles.mark} aria-hidden='true'>
      <Mark />
    </span>
  )
}

/**
 * One fallback model, tried in order after the block's own model fails: the model, the secret
 * holding its key when it runs on another provider, and any tuning its model needs that the
 * primary's settings cannot supply.
 */
export function FallbackRow({
  row,
  index,
  isLast,
  canMove,
  needsApiKey,
  tuningFields,
  modelOptions,
  takenModels,
  secretOptions,
  readOnly,
  onChangeModel,
  onChangeApiKey,
  onChangeTuning,
  onMove,
  onRemove,
  onCreateSecret,
}: FallbackRowProps) {
  const ordinal = ordinalChoiceLabel(index)
  const selectedModel = modelOptions.find((option) => option.value === row.model)
  const options = modelOptions.map((option) => ({
    value: option.value,
    label: option.label,
    leading: option.icon ? <ModelMark icon={option.icon} /> : undefined,
    disabled: option.value !== row.model && takenModels.has(option.value),
    disabledReason: 'Already in the fallback list',
  }))
  // Only a whole reference is ever shown; anything else that reached the store reads as unset.
  const apiKey = isWholeEnvVarReference(row.apiKey) ? row.apiKey : ''
  const apiKeyOption = secretOptions.find((option) => option.value === apiKey)

  return (
    <RuleCard
      label={ordinal}
      title={ordinal}
      actions={
        readOnly ? undefined : (
          <>
            {canMove && (
              <>
                <IconButton
                  label='Move up'
                  icon='I023'
                  size='compact'
                  tooltip
                  disabled={index === 0}
                  onClick={() => onMove(row.id, -1)}
                />
                <IconButton
                  label='Move down'
                  icon='I102'
                  size='compact'
                  tooltip
                  disabled={isLast}
                  onClick={() => onMove(row.id, 1)}
                />
              </>
            )}
            <IconButton
              label='Remove fallback model'
              icon='I105'
              size='compact'
              tooltip
              onClick={() => onRemove(row.id)}
            />
          </>
        )
      }
    >
      <SearchableSelect
        label={`${ordinal} model`}
        labelHidden
        options={options}
        value={row.model || null}
        selectedLabel={row.model ? (selectedModel?.label ?? row.model) : undefined}
        selectedLeading={selectedModel?.icon ? <ModelMark icon={selectedModel.icon} /> : undefined}
        placeholder='Select a model'
        searchLabel='Search models'
        onValueChange={(next) => {
          if (next !== null) onChangeModel(row.id, next)
        }}
        disabled={readOnly}
      />
      {needsApiKey && (
        <SearchableSelect
          label='API key'
          options={secretOptions}
          value={apiKey || null}
          selectedLabel={apiKey ? (apiKeyOption?.label ?? apiKey) : undefined}
          placeholder='Select a secret'
          searchLabel='Search secrets'
          createLabel='Add secret'
          onCreate={onCreateSecret}
          onValueChange={(next) => {
            if (next !== null) onChangeApiKey(row.id, next)
          }}
          disabled={readOnly}
        />
      )}
      {tuningFields.map(({ knob, options: values }) => (
        <Select
          key={knob}
          label={FALLBACK_TUNING_LABELS[knob]}
          field={EMPTY_FIELD}
          options={values}
          value={row[knob] ?? values[0]?.value ?? ''}
          onValueChange={(next) => onChangeTuning(row.id, knob, next)}
          disabled={readOnly}
        />
      ))}
    </RuleCard>
  )
}
