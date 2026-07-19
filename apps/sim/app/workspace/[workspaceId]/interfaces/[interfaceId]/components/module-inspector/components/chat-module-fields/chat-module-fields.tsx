'use client'

import { useMemo } from 'react'
import {
  ChipCombobox,
  ChipTextarea,
  type ComboboxOption,
  type ComboboxOptionGroup,
  cn,
  FieldDivider,
  Switch,
} from '@sim/emcn'
import { serializeOutputId, serializeSelectedOutputs } from '@/lib/core/utils/response-format'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import type { ChatModuleConfig, InterfaceOutputConfig } from '@/lib/interfaces/types'
import { flattenWorkflowOutputs } from '@/lib/workflows/blocks/flatten-outputs'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'
import { ResourcePickerField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/resource-picker-field'
import { useWorkflowState, useWorkflows } from '@/hooks/queries/workflows'

/**
 * Separator between block id and output path in a picker option value —
 * the wire format {@link serializeOutputId} produces and
 * `/api/workflows/[id]/execute` decodes with `indexOf('_')`, so a module's
 * `outputConfigs` round-trip through the picker unchanged.
 */
const OUTPUT_VALUE_SEPARATOR = '_'

/** Path a chat deployment assumes when an output config carries none. */
const DEFAULT_OUTPUT_PATH = 'content'

/**
 * `Combobox` ignores `options` whenever `groups` is set, but its type still
 * requires the prop. Shared empty array so the identity stays stable.
 */
const NO_UNGROUPED_OPTIONS: ComboboxOption[] = []

/**
 * Decodes a picker option value produced by {@link serializeOutputId} back
 * into an output config. Picker-specific: the shared module owns only the
 * encode half of the format.
 */
function decodeOutputValue(value: string): InterfaceOutputConfig {
  const index = value.indexOf(OUTPUT_VALUE_SEPARATOR)
  if (index === -1) return { blockId: value, path: DEFAULT_OUTPUT_PATH }
  return {
    blockId: value.slice(0, index),
    path: value.slice(index + OUTPUT_VALUE_SEPARATOR.length),
  }
}

export interface ChatModuleFieldsProps {
  workspaceId: string
  value: ChatModuleConfig
  /**
   * The second argument reports whether the emitted config is safe to persist.
   * Every control here is bounded by its own `maxLength`, and an unresolvable
   * workflow id is tolerated by design, so this section always reports `true`.
   */
  onChange: (next: ChatModuleConfig, isValid: boolean) => void
  disabled?: boolean
}

/**
 * Config section for a chat module: which workspace workflow the module runs,
 * which of its block outputs stream back, whether intermediate block progress
 * is shown, and the greeting rendered before the first message.
 *
 * Output options come from `flattenWorkflowOutputs` over the *selected*
 * workflow's fetched state rather than the editor's Zustand stores, so any
 * workflow in the workspace can be wired — not only the one currently open.
 * That helper already orders terminal blocks first (the deploy modal's
 * ordering) and `Map` insertion order preserves it through the grouping, so
 * the options need no further sort.
 */
export function ChatModuleFields({
  workspaceId,
  value,
  onChange,
  disabled = false,
}: ChatModuleFieldsProps) {
  const workflows = useWorkflows(workspaceId)
  const workflowState = useWorkflowState(value.workflowId ?? undefined)

  const outputGroups = useMemo<ComboboxOptionGroup[]>(() => {
    const state = workflowState.data
    if (!state?.blocks) return []

    const blocks = Object.values(state.blocks)
    const flattened = flattenWorkflowOutputs(blocks, state.edges ?? [])
    if (flattened.length === 0) return []

    const groups = new Map<string, ComboboxOptionGroup>()
    for (const output of flattened) {
      let group = groups.get(output.blockId)
      if (!group) {
        group = { section: output.blockName, items: [] }
        groups.set(output.blockId, group)
      }
      group.items.push({
        label: output.path,
        value: serializeOutputId({ blockId: output.blockId, path: output.path }),
      })
    }
    return [...groups.values()]
  }, [workflowState.data])

  const knownOutputValues = useMemo(() => {
    const values = new Set<string>()
    for (const group of outputGroups) {
      for (const item of group.items) values.add(item.value)
    }
    return values
  }, [outputGroups])

  const selectedOutputValues = useMemo(
    () => serializeSelectedOutputs(value.outputConfigs),
    [value.outputConfigs]
  )

  /**
   * Trigger summary, mirroring the deployed-chat output picker. Counts only
   * outputs that still resolve against the workflow, so a block deleted after
   * the module was wired reads as "nothing picked" instead of a raw id.
   */
  const selectedOutputSummary = useMemo(() => {
    const resolved = selectedOutputValues.filter((output) => knownOutputValues.has(output))
    if (resolved.length === 0) return null
    return resolved.length === 1 ? '1 output' : `${resolved.length} outputs`
  }, [selectedOutputValues, knownOutputValues])

  /**
   * Applies a workflow pick or clear. Swapping workflows drops every output
   * config because those are block-scoped.
   */
  const handleWorkflowChange = (workflowId: string | null) => {
    if (workflowId === value.workflowId) return
    onChange({ ...value, workflowId, outputConfigs: [] }, true)
  }

  return (
    <>
      <ResourcePickerField
        title='Workflow'
        missingMessage='This workflow is no longer in the workspace.'
        placeholder='Select a workflow'
        searchPlaceholder='Search workflows...'
        emptyMessage='No workflows in this workspace'
        items={workflows.data}
        isLoading={workflows.isLoading}
        value={value.workflowId}
        onChange={handleWorkflowChange}
        disabled={disabled}
      />

      <FieldDivider />

      <InspectorField title='Outputs'>
        <ChipCombobox
          multiSelect
          searchable
          searchPlaceholder='Search outputs...'
          options={NO_UNGROUPED_OPTIONS}
          groups={outputGroups}
          multiSelectValues={selectedOutputValues}
          onMultiSelectChange={(next) =>
            onChange({ ...value, outputConfigs: next.map(decodeOutputValue) }, true)
          }
          overlayContent={
            <span
              className={cn(
                'truncate',
                selectedOutputSummary ? 'text-[var(--text-body)]' : 'text-[var(--text-muted)]'
              )}
            >
              {selectedOutputSummary ?? 'Select outputs'}
            </span>
          }
          emptyMessage={
            value.workflowId ? 'This workflow has no outputs' : 'Select a workflow first'
          }
          isLoading={workflowState.isLoading}
          disabled={disabled || !value.workflowId}
          maxHeight={280}
          aria-label='Outputs'
        />
      </InspectorField>

      <FieldDivider />

      <InspectorField title='Show thinking'>
        {(control) => (
          <Switch
            checked={value.showThinking}
            onCheckedChange={(checked) => onChange({ ...value, showThinking: checked }, true)}
            disabled={disabled}
            {...control}
          />
        )}
      </InspectorField>

      <FieldDivider />

      <InspectorField title='Welcome message'>
        {(control) => (
          <ChipTextarea
            rows={3}
            maxLength={INTERFACE_LAYOUT_LIMITS.MAX_WELCOME_MESSAGE_LENGTH}
            value={value.welcomeMessage}
            onChange={(event) => onChange({ ...value, welcomeMessage: event.target.value }, true)}
            placeholder='How can I help?'
            disabled={disabled}
            {...control}
          />
        )}
      </InspectorField>
    </>
  )
}
