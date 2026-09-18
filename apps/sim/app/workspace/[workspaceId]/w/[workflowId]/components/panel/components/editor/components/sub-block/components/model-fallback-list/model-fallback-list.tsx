'use client'

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Button, Combobox, type ComboboxOption, Label, Tooltip } from '@sim/emcn'
import { ChevronDown, ChevronUp, Plus, Trash } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import { writePendingCredentialCreateRequest } from '@/lib/credentials/client-state'
import {
  addFallbackRow,
  changeFallbackRowApiKey,
  changeFallbackRowModel,
  changeFallbackRowTuning,
  FALLBACK_TUNING_LABELS,
  type FallbackModelEntry,
  type FallbackTuningKnob,
  fallbackRowNeedsApiKey,
  getFallbackTuningKnobsToShow,
  getTuningOptionsForModel,
  isViableFallbackModel,
  isWholeEnvVarReference,
  MAX_FALLBACK_MODELS,
  moveFallbackRow,
  ordinalChoiceLabel,
  removeFallbackRow,
} from '@/lib/workflows/blocks/fallback-models'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { getModelOptions } from '@/blocks/utils'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useProvidersStore } from '@/stores/providers/store'

const CREATE_SECRET_VALUE = 'action-create-secret'

/** The sibling values a preview renders against, since the store holds the live block's. */
export interface FallbackListPreviewPrimary {
  model?: unknown
  reasoningEffort?: unknown
  thinkingLevel?: unknown
  verbosity?: unknown
}

interface ModelFallbackListProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FallbackModelEntry[] | null
  /** Required for a faithful preview; ignored outside preview mode. */
  previewPrimary?: FallbackListPreviewPrimary
  disabled?: boolean
}

/** A viable model before the per-row `disabled` flag is stamped on it. */
interface ViableModelOption {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}

interface FallbackRowProps {
  row: FallbackModelEntry
  index: number
  /** The row can move down only while another follows it. */
  isLast: boolean
  /** Move controls render only once a second row exists. */
  canMove: boolean
  primaryModel: string
  primaryTuning: Partial<Record<FallbackTuningKnob, unknown>>
  viableOptions: ViableModelOption[]
  /** Models any row holds; a row's own model is exempted when its options are built. */
  takenModels: ReadonlySet<string>
  envVarOptions: ComboboxOption[]
  readOnly: boolean
  onChangeModel: (id: string, model: string) => void
  onChangeApiKey: (id: string, apiKey: string) => void
  onChangeTuning: (id: string, knob: FallbackTuningKnob, value: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
}

const FallbackRow = memo(function FallbackRow({
  row,
  index,
  isLast,
  canMove,
  primaryModel,
  primaryTuning,
  viableOptions,
  takenModels,
  envVarOptions,
  readOnly,
  onChangeModel,
  onChangeApiKey,
  onChangeTuning,
  onMove,
  onRemove,
}: FallbackRowProps) {
  const modelOptions = useMemo(
    (): ComboboxOption[] =>
      viableOptions.map((option) => ({
        ...option,
        disabled: option.value !== row.model && takenModels.has(option.value),
      })),
    [viableOptions, takenModels, row.model]
  )

  const { needsApiKey, tuningFields } = useMemo(() => {
    if (!row.model) return { needsApiKey: false, tuningFields: [] }
    return {
      needsApiKey: fallbackRowNeedsApiKey(row.model, primaryModel),
      tuningFields: getFallbackTuningKnobsToShow(row.model, primaryModel, primaryTuning).map(
        (knob) => ({
          knob,
          options: (getTuningOptionsForModel(row.model, knob) ?? []).map(
            (value): ComboboxOption => ({ label: value, value })
          ),
        })
      ),
    }
  }, [row.model, primaryModel, primaryTuning])

  /** Only a reference is ever shown; anything else that reached the store reads as unset. */
  const apiKeyValue = isWholeEnvVarReference(row.apiKey) ? row.apiKey : ''

  return (
    <div
      data-fallback-row-id={row.id}
      className='overflow-visible rounded-sm border border-[var(--border-1)]'
    >
      <div className='flex items-center justify-between rounded-t-[4px] border-[var(--border-1)] border-b bg-[var(--surface-4)] px-2.5 py-[5px]'>
        <span className='text-[var(--text-tertiary)] text-sm'>{ordinalChoiceLabel(index)}</span>
        <div className='flex items-center gap-2'>
          {canMove && (
            <>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={() => onMove(row.id, -1)}
                    disabled={readOnly || index === 0}
                    className='h-auto p-0'
                    aria-label='Move up'
                  >
                    <ChevronUp className='size-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Move up</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={() => onMove(row.id, 1)}
                    disabled={readOnly || isLast}
                    className='h-auto p-0'
                    aria-label='Move down'
                  >
                    <ChevronDown className='size-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Move down</Tooltip.Content>
              </Tooltip.Root>
            </>
          )}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={() => onRemove(row.id)}
                disabled={readOnly}
                className='h-auto p-0 text-[var(--text-error)] hover-hover:text-[var(--text-error)]'
                aria-label='Remove fallback model'
              >
                <Trash className='size-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Remove</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      <div className='flex flex-col gap-2 px-2.5 pt-1.5 pb-2.5'>
        <div className='flex flex-col gap-1.5'>
          <Label>Model</Label>
          <Combobox
            options={modelOptions}
            value={row.model}
            onChange={(model) => onChangeModel(row.id, model)}
            placeholder='Select a model'
            disabled={readOnly}
            searchable
            searchPlaceholder='Search models...'
            maxHeight={240}
            emptyMessage='No models available'
          />
        </div>
        {needsApiKey && (
          <div className='flex flex-col gap-1.5'>
            <Label>API key</Label>
            <Combobox
              options={envVarOptions}
              value={apiKeyValue}
              onChange={(apiKey) => onChangeApiKey(row.id, apiKey)}
              placeholder='Select a secret'
              disabled={readOnly}
              searchable
              searchPlaceholder='Search secrets...'
              maxHeight={240}
              emptyMessage='No secrets'
            />
          </div>
        )}
        {tuningFields.map(({ knob, options }) => (
          <div key={knob} className='flex flex-col gap-1.5'>
            <Label>{FALLBACK_TUNING_LABELS[knob]}</Label>
            <Combobox
              options={options}
              value={row[knob] ?? options[0]?.value ?? ''}
              onChange={(value) => onChangeTuning(row.id, knob, value)}
              placeholder={`Select ${FALLBACK_TUNING_LABELS[knob].toLowerCase()}`}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
    </div>
  )
})

/**
 * Ordered fallback models for a model-driven block: the 2nd, 3rd, ... choice
 * tried in sequence when the request to the block's own model fails.
 *
 * Every write is the whole array, so a collaborator's concurrent edit and an
 * undo both flow straight through the store. A row's key is stored only as a
 * `{{ENV_VAR}}` reference: the picker offers the workspace's secret names and
 * nothing else, which is what keeps a raw secret out of the list value (see
 * `FallbackModelEntry`). The row transforms live in `fallback-models.ts`.
 */
export function ModelFallbackList({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  previewPrimary,
  disabled = false,
}: ModelFallbackListProps) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const { navigateToSettings } = useSettingsNavigation()
  const { isModelUsable } = usePermissionConfig()
  const providers = useProvidersStore((state) => state.providers)
  const [storeValue, setStoreValue] = useSubBlockValue<FallbackModelEntry[]>(blockId, subBlockId)
  const [primaryModelValue] = useSubBlockValue<string>(blockId, 'model')
  const [primaryReasoningEffort] = useSubBlockValue<string>(blockId, 'reasoningEffort')
  const [primaryThinkingLevel] = useSubBlockValue<string>(blockId, 'thinkingLevel')
  const [primaryVerbosity] = useSubBlockValue<string>(blockId, 'verbosity')
  const { data: personalEnv = {} } = usePersonalEnvironment()
  const { data: workspaceEnv } = useWorkspaceEnvironment(workspaceId, {
    enabled: Boolean(workspaceId),
  })

  const readOnly = isPreview || disabled
  /** A preview shows another version's rows, so its gates read that version's primary, not the live one. */
  const primarySource = isPreview
    ? {
        model: previewPrimary?.model,
        reasoningEffort: previewPrimary?.reasoningEffort,
        thinkingLevel: previewPrimary?.thinkingLevel,
        verbosity: previewPrimary?.verbosity,
      }
    : {
        model: primaryModelValue,
        reasoningEffort: primaryReasoningEffort,
        thinkingLevel: primaryThinkingLevel,
        verbosity: primaryVerbosity,
      }
  const primaryModel = typeof primarySource.model === 'string' ? primarySource.model : ''
  const {
    reasoningEffort: sourceReasoningEffort,
    thinkingLevel: sourceThinkingLevel,
    verbosity: sourceVerbosity,
  } = primarySource
  const primaryTuning = useMemo(
    () => ({
      reasoningEffort: sourceReasoningEffort,
      thinkingLevel: sourceThinkingLevel,
      verbosity: sourceVerbosity,
    }),
    [sourceReasoningEffort, sourceThinkingLevel, sourceVerbosity]
  )
  const rows: FallbackModelEntry[] = useMemo(() => {
    const value = isPreview ? previewValue : storeValue
    return Array.isArray(value) ? value : []
  }, [isPreview, previewValue, storeValue])

  /**
   * `getModelOptions` reads the providers store itself; subscribing to
   * `providers` here is what recomputes the list when a dynamic provider's
   * models finish loading.
   */
  const viableOptions = useMemo(
    (): ViableModelOption[] =>
      getModelOptions()
        .filter(
          (option) => isModelUsable(option.id) && isViableFallbackModel(option.id, primaryModel)
        )
        .map((option) => ({
          label: option.label,
          value: option.id,
          ...(option.icon ? { icon: option.icon } : {}),
        })),
    [primaryModel, isModelUsable, providers]
  )

  const takenModels = useMemo(() => new Set(rows.map((row) => row.model).filter(Boolean)), [rows])

  const envVarOptions = useMemo((): ComboboxOption[] => {
    const names = workspaceId
      ? [
          ...Object.keys(workspaceEnv?.workspace ?? {}),
          ...Object.keys(workspaceEnv?.personal ?? {}),
        ]
      : Object.keys(personalEnv)
    const options: ComboboxOption[] = [...new Set(names)].map((name) => ({
      label: name,
      value: `{{${name}}}`,
    }))
    options.push({
      label: 'Create Secret',
      value: CREATE_SECRET_VALUE,
      icon: Plus,
      onSelect: () => {
        if (workspaceId) {
          writePendingCredentialCreateRequest({
            workspaceId,
            type: 'env_personal',
            requestedAt: Date.now(),
          })
        }
        navigateToSettings({ section: 'secrets' })
      },
    })
    return options
  }, [workspaceId, workspaceEnv, personalEnv, navigateToSettings])

  /**
   * Handlers read the latest rows through a ref so their identity survives an
   * edit; otherwise every keystroke in one row would re-render all of them.
   */
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const write = useCallback(
    (transform: (current: FallbackModelEntry[]) => FallbackModelEntry[]) => {
      if (readOnly) return
      const current = rowsRef.current
      const next = transform(current)
      if (next !== current) setStoreValue(next)
    },
    [readOnly, setStoreValue]
  )

  const handleAdd = useCallback(
    () => write((current) => addFallbackRow(current, generateShortId())),
    [write]
  )
  const handleRemove = useCallback(
    (id: string) => write((current) => removeFallbackRow(current, id)),
    [write]
  )
  const handleMove = useCallback(
    (id: string, direction: -1 | 1) => write((current) => moveFallbackRow(current, id, direction)),
    [write]
  )
  const handleChangeModel = useCallback(
    (id: string, model: string) =>
      write((current) => changeFallbackRowModel(current, id, model, primaryModel)),
    [primaryModel, write]
  )
  const handleChangeTuning = useCallback(
    (id: string, knob: FallbackTuningKnob, value: string) =>
      write((current) => changeFallbackRowTuning(current, id, knob, value)),
    [write]
  )
  const handleChangeApiKey = useCallback(
    (id: string, apiKey: string) => {
      if (apiKey === CREATE_SECRET_VALUE) return
      write((current) => changeFallbackRowApiKey(current, id, apiKey))
    },
    [write]
  )

  return (
    <div className='space-y-2'>
      {rows.map((row, index) => (
        <FallbackRow
          key={row.id}
          row={row}
          index={index}
          isLast={index === rows.length - 1}
          canMove={rows.length > 1}
          primaryModel={primaryModel}
          primaryTuning={primaryTuning}
          viableOptions={viableOptions}
          takenModels={takenModels}
          envVarOptions={envVarOptions}
          readOnly={readOnly}
          onChangeModel={handleChangeModel}
          onChangeApiKey={handleChangeApiKey}
          onChangeTuning={handleChangeTuning}
          onMove={handleMove}
          onRemove={handleRemove}
        />
      ))}
      {!readOnly && (
        <Button
          variant='ghost'
          onClick={handleAdd}
          disabled={rows.length >= MAX_FALLBACK_MODELS}
          className='h-7 w-full justify-start gap-1.5 border border-[var(--border-1)] border-dashed text-[var(--text-muted)] text-small'
        >
          <Plus className='size-[14px]' />
          Add fallback model
        </Button>
      )}
    </div>
  )
}
