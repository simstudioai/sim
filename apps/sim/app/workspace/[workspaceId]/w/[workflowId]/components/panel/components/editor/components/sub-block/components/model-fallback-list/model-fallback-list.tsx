'use client'

import { useCallback, useMemo } from 'react'
import { Button, ChipCombobox, type ComboboxOption, Label, Tooltip } from '@sim/emcn'
import { ChevronDown, ChevronUp, Plus, Trash } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import { writePendingCredentialCreateRequest } from '@/lib/credentials/client-state'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import {
  FALLBACK_TUNING_LABELS,
  type FallbackModelEntry,
  type FallbackTuningKnob,
  fallbackRowNeedsApiKey,
  getFallbackTuningKnobsToShow,
  getTuningOptionsForModel,
  isViableFallbackModel,
  MAX_FALLBACK_MODELS,
  ordinalChoiceLabel,
} from '@/lib/workflows/blocks/fallback-models'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { getModelOptions } from '@/blocks/utils'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useProvidersStore } from '@/stores/providers/store'

const CREATE_VARIABLE_VALUE = 'action-create-variable'

interface ModelFallbackListProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FallbackModelEntry[] | null
  disabled?: boolean
}

interface FallbackRowProps {
  row: FallbackModelEntry
  index: number
  count: number
  primaryModel: string
  primaryTuning: Partial<Record<FallbackTuningKnob, unknown>>
  modelOptions: ComboboxOption[]
  envVarOptions: ComboboxOption[]
  readOnly: boolean
  onChangeModel: (id: string, model: string) => void
  onChangeApiKey: (id: string, apiKey: string) => void
  onChangeTuning: (id: string, knob: FallbackTuningKnob, value: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
}

function selectWorkspaceEnvironment(data: WorkspaceEnvironmentData): WorkspaceEnvironmentData {
  return {
    workspace: data.workspace || {},
    personal: data.personal || {},
    conflicts: data.conflicts || [],
  }
}

function FallbackRow({
  row,
  index,
  count,
  primaryModel,
  primaryTuning,
  modelOptions,
  envVarOptions,
  readOnly,
  onChangeModel,
  onChangeApiKey,
  onChangeTuning,
  onMove,
  onRemove,
}: FallbackRowProps) {
  const needsApiKey = fallbackRowNeedsApiKey(row.model, primaryModel)
  const tuningKnobs = row.model
    ? getFallbackTuningKnobsToShow(row.model, primaryModel, primaryTuning)
    : []

  return (
    <div
      data-fallback-row-id={row.id}
      className='overflow-visible rounded-sm border border-[var(--border-1)]'
    >
      <div className='flex items-center justify-between rounded-t-[4px] border-[var(--border-1)] border-b bg-[var(--surface-4)] px-2.5 py-[5px]'>
        <span className='text-[var(--text-tertiary)] text-sm'>{ordinalChoiceLabel(index)}</span>
        <div className='flex items-center gap-2'>
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
                disabled={readOnly || index === count - 1}
                className='h-auto p-0'
                aria-label='Move down'
              >
                <ChevronDown className='size-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Move down</Tooltip.Content>
          </Tooltip.Root>
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
          <ChipCombobox
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
            <ChipCombobox
              options={envVarOptions}
              value={row.apiKey ?? ''}
              onChange={(apiKey) => onChangeApiKey(row.id, apiKey)}
              placeholder='Select an environment variable'
              disabled={readOnly}
              searchable
              searchPlaceholder='Search variables...'
              maxHeight={240}
              emptyMessage='No environment variables'
            />
          </div>
        )}
        {tuningKnobs.map((knob) => {
          const options = getTuningOptionsForModel(row.model, knob) ?? []
          return (
            <div key={knob} className='flex flex-col gap-1.5'>
              <Label>{FALLBACK_TUNING_LABELS[knob]}</Label>
              <ChipCombobox
                options={options.map((value) => ({ label: value, value }))}
                value={row[knob] ?? options[0] ?? ''}
                onChange={(value) => onChangeTuning(row.id, knob, value)}
                placeholder={`Select ${FALLBACK_TUNING_LABELS[knob].toLowerCase()}`}
                disabled={readOnly}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Ordered fallback models for a model-driven block: the 2nd, 3rd, ... choice
 * tried in sequence when the request to the block's own model fails.
 *
 * Every write is the whole array, so a collaborator's concurrent edit and an
 * undo both flow straight through the store. A row's key is stored only as a
 * `{{ENV_VAR}}` reference: the picker offers the workspace's variable names and
 * nothing else, which is what keeps a raw secret out of the list value (see
 * `FallbackModelEntry`).
 */
export function ModelFallbackList({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
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
    select: selectWorkspaceEnvironment,
  })

  const readOnly = isPreview || disabled
  const primaryModel = typeof primaryModelValue === 'string' ? primaryModelValue : ''
  const primaryTuning = useMemo(
    () => ({
      reasoningEffort: primaryReasoningEffort,
      thinkingLevel: primaryThinkingLevel,
      verbosity: primaryVerbosity,
    }),
    [primaryReasoningEffort, primaryThinkingLevel, primaryVerbosity]
  )
  const rows: FallbackModelEntry[] = useMemo(() => {
    const value = isPreview ? previewValue : storeValue
    return Array.isArray(value) ? value : []
  }, [isPreview, previewValue, storeValue])

  const modelOptions = useMemo((): ComboboxOption[] => {
    const chosen = new Set(rows.map((row) => row.model))
    return getModelOptions()
      .filter(
        (option) => isModelUsable(option.id) && isViableFallbackModel(option.id, primaryModel)
      )
      .map((option) => ({
        label: option.label,
        value: option.id,
        ...(option.icon ? { icon: option.icon } : {}),
        disabled: chosen.has(option.id),
      }))
    // `providers` is what changes the option list; `getModelOptions` reads it from the store.
  }, [rows, primaryModel, isModelUsable, providers])

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
      label: 'Create variable',
      value: CREATE_VARIABLE_VALUE,
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

  const write = useCallback(
    (next: FallbackModelEntry[]) => {
      if (readOnly) return
      setStoreValue(next)
    },
    [readOnly, setStoreValue]
  )

  const handleAdd = useCallback(() => {
    if (rows.length >= MAX_FALLBACK_MODELS) return
    write([...rows, { id: generateShortId(), model: '' }])
  }, [rows, write])

  const handleRemove = useCallback(
    (id: string) => write(rows.filter((row) => row.id !== id)),
    [rows, write]
  )

  const handleMove = useCallback(
    (id: string, direction: -1 | 1) => {
      const index = rows.findIndex((row) => row.id === id)
      const target = index + direction
      if (index === -1 || target < 0 || target >= rows.length) return
      const next = [...rows]
      ;[next[index], next[target]] = [next[target], next[index]]
      write(next)
    },
    [rows, write]
  )

  const handleChangeModel = useCallback(
    (id: string, model: string) => {
      write(
        rows.map((row) => {
          if (row.id !== id) return row
          /** A new model gets a clean row: a key it no longer needs and tuning it may not declare both go. */
          const keepKey = row.apiKey && fallbackRowNeedsApiKey(model, primaryModel)
          return { id: row.id, model, ...(keepKey ? { apiKey: row.apiKey } : {}) }
        })
      )
    },
    [rows, primaryModel, write]
  )

  const handleChangeTuning = useCallback(
    (id: string, knob: FallbackTuningKnob, value: string) => {
      write(
        rows.map((row) => {
          if (row.id !== id) return row
          /** The provider-decides entry is the field's default, so it is stored as absence. */
          const sentinel = getTuningOptionsForModel(row.model, knob)?.[0]
          const { [knob]: _previous, ...rest } = row
          return value && value !== sentinel ? { ...rest, [knob]: value } : rest
        })
      )
    },
    [rows, write]
  )

  const handleChangeApiKey = useCallback(
    (id: string, apiKey: string) => {
      if (apiKey === CREATE_VARIABLE_VALUE) return
      write(rows.map((row) => (row.id === id ? { ...row, apiKey } : row)))
    },
    [rows, write]
  )

  return (
    <div className='space-y-2'>
      {rows.map((row, index) => (
        <FallbackRow
          key={row.id}
          row={row}
          index={index}
          count={rows.length}
          primaryModel={primaryModel}
          primaryTuning={primaryTuning}
          modelOptions={modelOptions}
          envVarOptions={envVarOptions}
          readOnly={readOnly}
          onChangeModel={handleChangeModel}
          onChangeApiKey={handleChangeApiKey}
          onChangeTuning={handleChangeTuning}
          onMove={handleMove}
          onRemove={handleRemove}
        />
      ))}
      <Button
        variant='ghost'
        size='sm'
        onClick={handleAdd}
        disabled={readOnly || rows.length >= MAX_FALLBACK_MODELS}
        className='h-auto gap-1.5 px-0 py-0'
      >
        <Plus className='size-[14px]' />
        Add fallback model
      </Button>
    </div>
  )
}
