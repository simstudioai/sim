'use client'

import { Button } from '@sim/emcn/button'
import { generateShortId } from '@sim/utils/id'
import { toArray } from '@sim/utils/object'
import { RuleList } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import {
  FallbackRow,
  type FallbackTuningField,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/model-fallback-list/fallback-row'
import { useSubBlockValue, useWorkflowScope } from '@/platform/lib/data/workflow-editor'
import {
  addFallbackRow,
  changeFallbackRowApiKey,
  changeFallbackRowModel,
  changeFallbackRowTuning,
  type FallbackModelEntry,
  fallbackRowNeedsApiKey,
  getFallbackTuningKnobsToShow,
  getTuningOptionsForModel,
  MAX_FALLBACK_MODELS,
  moveFallbackRow,
  removeFallbackRow,
  useFallbackModelOptions,
  useSecretReferenceOptions,
} from '@/platform/lib/data/workflow-editor/builders'

interface ModelFallbackListProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  /** The previewed version's own primary model and tuning; ignored outside preview mode. */
  previewPrimary?: {
    model?: unknown
    reasoningEffort?: unknown
    thinkingLevel?: unknown
    verbosity?: unknown
  }
  disabled?: boolean
}

/**
 * Ordered fallback models for a model-driven block: the 2nd, 3rd, ... choice tried in sequence
 * when the request to the block's own model fails.
 *
 * Every write is the whole array, so a collaborator's concurrent edit and an undo both flow
 * straight through the store. A row's key is stored only as a `{{SECRET}}` reference: the picker
 * offers the workspace's secret names and nothing else, which keeps a raw secret out of the list
 * value. The row transforms are the shared `fallback-models` module's.
 */
export function ModelFallbackList({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  previewPrimary,
  disabled = false,
}: ModelFallbackListProps) {
  const { workspaceId } = useWorkflowScope()
  const [storeValue, setStoreValue] = useSubBlockValue<FallbackModelEntry[]>(blockId, subBlockId)
  const [primaryModelValue] = useSubBlockValue<string>(blockId, 'model')
  const [primaryReasoningEffort] = useSubBlockValue<string>(blockId, 'reasoningEffort')
  const [primaryThinkingLevel] = useSubBlockValue<string>(blockId, 'thinkingLevel')
  const [primaryVerbosity] = useSubBlockValue<string>(blockId, 'verbosity')

  const readOnly = isPreview || disabled
  // A preview shows another version's rows, so its gates read that version's primary.
  const primary: NonNullable<ModelFallbackListProps['previewPrimary']> = isPreview
    ? (previewPrimary ?? {})
    : {
        model: primaryModelValue,
        reasoningEffort: primaryReasoningEffort,
        thinkingLevel: primaryThinkingLevel,
        verbosity: primaryVerbosity,
      }
  const primaryModel = typeof primary.model === 'string' ? primary.model : ''
  const primaryTuning = {
    reasoningEffort: primary.reasoningEffort,
    thinkingLevel: primary.thinkingLevel,
    verbosity: primary.verbosity,
  }
  const rows = toArray<FallbackModelEntry>(isPreview ? previewValue : storeValue)
  const modelOptions = useFallbackModelOptions(primaryModel)
  const { options: secretOptions, openCreateSecret } = useSecretReferenceOptions({ workspaceId })
  const takenModels = new Set(rows.map((row) => row.model).filter(Boolean))

  const write = (transform: (current: FallbackModelEntry[]) => FallbackModelEntry[]) => {
    if (readOnly) return
    const next = transform(rows)
    if (next !== rows) setStoreValue(next)
  }

  const tuningFieldsFor = (model: string): FallbackTuningField[] =>
    getFallbackTuningKnobsToShow(model, primaryModel, primaryTuning).map((knob) => ({
      knob,
      options: (getTuningOptionsForModel(model, knob) ?? []).map((value) => ({
        value,
        label: value,
      })),
    }))

  return (
    <RuleList
      action={
        readOnly ? undefined : (
          <Button
            size='compact'
            icon='I074'
            disabled={rows.length >= MAX_FALLBACK_MODELS}
            disabledReason={`Up to ${MAX_FALLBACK_MODELS} fallback models`}
            onClick={() => write((current) => addFallbackRow(current, generateShortId()))}
          >
            Add fallback model
          </Button>
        )
      }
    >
      {rows.map((row, index) => (
        <FallbackRow
          key={row.id}
          row={row}
          index={index}
          isLast={index === rows.length - 1}
          canMove={rows.length > 1}
          needsApiKey={fallbackRowNeedsApiKey(row.model, primaryModel)}
          tuningFields={tuningFieldsFor(row.model)}
          modelOptions={modelOptions}
          takenModels={takenModels}
          secretOptions={secretOptions}
          readOnly={readOnly}
          onChangeModel={(id, model) =>
            write((current) => changeFallbackRowModel(current, id, model, primaryModel))
          }
          onChangeApiKey={(id, apiKey) =>
            write((current) => changeFallbackRowApiKey(current, id, apiKey))
          }
          onChangeTuning={(id, knob, value) =>
            write((current) => changeFallbackRowTuning(current, id, knob, value))
          }
          onMove={(id, direction) => write((current) => moveFallbackRow(current, id, direction))}
          onRemove={(id) => write((current) => removeFallbackRow(current, id))}
          onCreateSecret={openCreateSecret}
        />
      ))}
    </RuleList>
  )
}
