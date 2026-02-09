'use client'

import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { Combobox, Switch } from '@/components/emcn'
import {
  CheckboxList,
  Code,
  DocumentSelector,
  DocumentTagEntry,
  FileSelectorInput,
  FileUpload,
  FolderSelectorInput,
  KnowledgeBaseSelector,
  KnowledgeTagFilters,
  LongInput,
  ProjectSelectorInput,
  SheetSelectorInput,
  ShortInput,
  SlackSelectorInput,
  SliderInput,
  Table,
  TimeInput,
  WorkflowSelectorInput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'
import { isPasswordParameter } from '@/tools/params'

interface ToolSubBlockRendererProps {
  blockId: string
  subBlockId: string
  toolIndex: number
  subBlock: BlockSubBlockConfig
  effectiveParamId: string
  toolParams: Record<string, string> | undefined
  onParamChange: (toolIndex: number, paramId: string, value: string) => void
  disabled: boolean
  previewContextValues?: Record<string, unknown>
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
}

/**
 * Renders a subblock component inside tool-input by bridging the subblock store
 * with StoredTool.params via a synthetic store key.
 *
 * Replaces the 17+ individual SyncWrapper components that previously existed.
 * Components read/write to the store at a synthetic ID, and two effects
 * handle bidirectional sync with tool.params.
 */
export function ToolSubBlockRenderer({
  blockId,
  subBlockId,
  toolIndex,
  subBlock,
  effectiveParamId,
  toolParams,
  onParamChange,
  disabled,
  previewContextValues,
  wandControlRef,
}: ToolSubBlockRendererProps) {
  const syntheticId = `${subBlockId}-tool-${toolIndex}-${effectiveParamId}`
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, syntheticId)

  // Gate the component using the same dependsOn logic as SubBlock
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    previewContextValues,
  })

  const toolParamValue = toolParams?.[effectiveParamId] ?? ''

  /** Tracks the last value we wrote to the store from tool.params to avoid echo loops */
  const lastInitRef = useRef<string>(toolParamValue)
  /** Tracks the last value we synced back to tool.params from the store */
  const lastSyncRef = useRef<string>(toolParamValue)

  // Init effect: push tool.params value into the store when it changes externally
  useEffect(() => {
    if (toolParamValue !== lastInitRef.current) {
      lastInitRef.current = toolParamValue
      lastSyncRef.current = toolParamValue
      setStoreValue(toolParamValue)
    }
  }, [toolParamValue, setStoreValue])

  // Sync effect: when the store changes (user interaction), push back to tool.params
  useEffect(() => {
    if (storeValue == null) return
    const stringValue = typeof storeValue === 'string' ? storeValue : JSON.stringify(storeValue)
    if (stringValue !== lastSyncRef.current) {
      lastSyncRef.current = stringValue
      lastInitRef.current = stringValue
      onParamChange(toolIndex, effectiveParamId, stringValue)
    }
  }, [storeValue, toolIndex, effectiveParamId, onParamChange])

  // Initialize the store on first mount
  const hasInitializedRef = useRef(false)
  useEffect(() => {
    if (!hasInitializedRef.current && toolParamValue) {
      hasInitializedRef.current = true
      setStoreValue(toolParamValue)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const configWithSyntheticId = { ...subBlock, id: syntheticId }

  return renderSubBlockComponent({
    blockId,
    syntheticId,
    config: configWithSyntheticId,
    subBlock,
    disabled: finalDisabled,
    previewContextValues,
    wandControlRef,
    toolParamValue,
    onParamChange: useCallback(
      (value: string) => onParamChange(toolIndex, effectiveParamId, value),
      [toolIndex, effectiveParamId, onParamChange]
    ),
  })
}

interface RenderContext {
  blockId: string
  syntheticId: string
  config: BlockSubBlockConfig
  subBlock: BlockSubBlockConfig
  disabled: boolean
  previewContextValues?: Record<string, unknown>
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
  toolParamValue: string
  onParamChange: (value: string) => void
}

/**
 * Renders the appropriate component for a subblock type.
 * Mirrors the switch cases in SubBlock's renderInput(), using
 * the same component props pattern.
 */
function renderSubBlockComponent(ctx: RenderContext): React.ReactNode {
  const {
    blockId,
    syntheticId,
    config,
    subBlock,
    disabled,
    previewContextValues,
    wandControlRef,
    toolParamValue,
    onParamChange,
  } = ctx

  switch (subBlock.type) {
    case 'short-input':
      return (
        <ShortInput
          blockId={blockId}
          subBlockId={syntheticId}
          placeholder={subBlock.placeholder}
          password={subBlock.password || isPasswordParameter(subBlock.id)}
          config={config}
          disabled={disabled}
          wandControlRef={wandControlRef}
          hideInternalWand={true}
        />
      )

    case 'long-input':
      return (
        <LongInput
          blockId={blockId}
          subBlockId={syntheticId}
          placeholder={subBlock.placeholder}
          rows={subBlock.rows}
          config={config}
          disabled={disabled}
          wandControlRef={wandControlRef}
          hideInternalWand={true}
        />
      )

    case 'dropdown':
      return (
        <Combobox
          options={
            (subBlock.options as { label: string; id: string }[] | undefined)
              ?.filter((option) => option.id !== '')
              .map((option) => ({
                label: option.label,
                value: option.id,
              })) || []
          }
          value={toolParamValue}
          onChange={onParamChange}
          placeholder={subBlock.placeholder || 'Select option'}
          disabled={disabled}
        />
      )

    case 'switch':
      return (
        <Switch
          checked={toolParamValue === 'true' || toolParamValue === 'True'}
          onCheckedChange={(checked) => onParamChange(checked ? 'true' : 'false')}
        />
      )

    case 'code':
      return (
        <Code
          blockId={blockId}
          subBlockId={syntheticId}
          placeholder={subBlock.placeholder}
          language={subBlock.language}
          generationType={subBlock.generationType}
          value={typeof subBlock.value === 'function' ? subBlock.value({}) : undefined}
          disabled={disabled}
          wandConfig={
            subBlock.wandConfig || {
              enabled: false,
              prompt: '',
              placeholder: '',
            }
          }
          wandControlRef={wandControlRef}
          hideInternalWand={true}
        />
      )

    case 'channel-selector':
    case 'user-selector':
      return (
        <SlackSelectorInput
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'project-selector':
      return (
        <ProjectSelectorInput
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'file-selector':
      return (
        <FileSelectorInput
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'sheet-selector':
      return (
        <SheetSelectorInput
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'folder-selector':
      return (
        <FolderSelectorInput
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'knowledge-base-selector':
      return <KnowledgeBaseSelector blockId={blockId} subBlock={config} disabled={disabled} />

    case 'document-selector':
      return (
        <DocumentSelector
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'document-tag-entry':
      return (
        <DocumentTagEntry
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'knowledge-tag-filters':
      return (
        <KnowledgeTagFilters
          blockId={blockId}
          subBlock={config}
          disabled={disabled}
          previewContextValues={previewContextValues}
        />
      )

    case 'table':
      return (
        <Table
          blockId={blockId}
          subBlockId={syntheticId}
          columns={subBlock.columns ?? []}
          disabled={disabled}
        />
      )

    case 'slider':
      return (
        <SliderInput
          blockId={blockId}
          subBlockId={syntheticId}
          min={subBlock.min}
          max={subBlock.max}
          step={subBlock.step}
          integer={subBlock.integer}
          disabled={disabled}
        />
      )

    case 'checkbox-list':
      return (
        <CheckboxList
          blockId={blockId}
          subBlockId={syntheticId}
          title={subBlock.title ?? ''}
          options={subBlock.options as { label: string; id: string }[]}
          disabled={disabled}
        />
      )

    case 'time-input':
      return (
        <TimeInput
          blockId={blockId}
          subBlockId={syntheticId}
          placeholder={subBlock.placeholder}
          disabled={disabled}
        />
      )

    case 'file-upload':
      return (
        <FileUpload
          blockId={blockId}
          subBlockId={syntheticId}
          acceptedTypes={subBlock.acceptedTypes || '*'}
          multiple={subBlock.multiple === true}
          maxSize={subBlock.maxSize}
          disabled={disabled}
        />
      )

    case 'combobox':
      return (
        <Combobox
          options={((subBlock.options as { label: string; id: string }[] | undefined) || []).map(
            (opt) => ({
              label: opt.label,
              value: opt.id,
            })
          )}
          value={toolParamValue}
          onChange={onParamChange}
          placeholder={subBlock.placeholder || 'Select option'}
          disabled={disabled}
        />
      )

    case 'workflow-selector':
      return <WorkflowSelectorInput blockId={blockId} subBlock={config} disabled={disabled} />

    case 'oauth-input':
      // OAuth inputs are handled separately by ToolCredentialSelector in the parent
      return null

    default:
      return (
        <ShortInput
          blockId={blockId}
          subBlockId={syntheticId}
          placeholder={subBlock.placeholder}
          password={isPasswordParameter(subBlock.id)}
          config={config}
          disabled={disabled}
        />
      )
  }
}
