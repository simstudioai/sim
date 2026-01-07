import { type JSX, type MouseEvent, memo, useRef, useState } from 'react'
import { AlertTriangle, Wand2 } from 'lucide-react'
import { Label, Tooltip } from '@/components/emcn/components'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/core/utils/cn'
import type { FieldDiffStatus } from '@/lib/workflows/diff/types'
import {
  CheckboxList,
  Code,
  ComboBox,
  ConditionInput,
  CredentialSelector,
  DocumentSelector,
  DocumentTagEntry,
  Dropdown,
  EvalInput,
  FileSelectorInput,
  FileUpload,
  FolderSelectorInput,
  GroupedCheckboxList,
  InputFormat,
  InputMapping,
  KnowledgeBaseSelector,
  KnowledgeTagFilters,
  LongInput,
  McpDynamicArgs,
  McpServerSelector,
  McpToolSelector,
  MessagesInput,
  ProjectSelectorInput,
  ResponseFormat,
  ScheduleInfo,
  ShortInput,
  SlackSelectorInput,
  SliderInput,
  Switch,
  Table,
  Text,
  TimeInput,
  ToolInput,
  TriggerSave,
  VariablesInput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import type { SubBlockConfig } from '@/blocks/types'

/**
 * Interface for wand control handlers exposed by sub-block inputs
 */
export interface WandControlHandlers {
  onWandTrigger: (prompt: string) => void
  isWandActive: boolean
  isWandStreaming: boolean
}

/**
 * Props for the SubBlock component.
 *
 * @remarks
 * SubBlock renders a single configurable input within a workflow block,
 * supporting various input types, preview mode, and conditional requirements.
 */
interface SubBlockProps {
  blockId: string
  config: SubBlockConfig
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
  fieldDiffStatus?: FieldDiffStatus
  allowExpandInPreview?: boolean
}

/**
 * Returns whether the field is required for validation.
 *
 * @remarks
 * Evaluates conditional requirements based on current field values.
 * Supports boolean, condition objects, and functions that return conditions.
 *
 * @param config - The sub-block configuration containing requirement rules
 * @param subBlockValues - Current values of all subblocks for condition evaluation
 * @returns `true` if the field is required based on current context
 */
const isFieldRequired = (config: SubBlockConfig, subBlockValues?: Record<string, any>): boolean => {
  if (!config.required) return false
  if (typeof config.required === 'boolean') return config.required

  // Helper function to evaluate a condition
  const evalCond = (
    cond: {
      field: string
      value: string | number | boolean | Array<string | number | boolean>
      not?: boolean
      and?: {
        field: string
        value: string | number | boolean | Array<string | number | boolean> | undefined
        not?: boolean
      }
    },
    values: Record<string, any>
  ): boolean => {
    const fieldValue = values[cond.field]?.value
    const condValue = cond.value

    let match: boolean
    if (Array.isArray(condValue)) {
      match = condValue.includes(fieldValue)
    } else {
      match = fieldValue === condValue
    }

    if (cond.not) match = !match

    if (cond.and) {
      const andFieldValue = values[cond.and.field]?.value
      const andCondValue = cond.and.value
      let andMatch: boolean
      if (Array.isArray(andCondValue)) {
        andMatch = andCondValue.includes(andFieldValue)
      } else {
        andMatch = andFieldValue === andCondValue
      }
      if (cond.and.not) andMatch = !andMatch
      match = match && andMatch
    }

    return match
  }

  // If required is a condition object or function, evaluate it
  const condition = typeof config.required === 'function' ? config.required() : config.required
  return evalCond(condition, subBlockValues || {})
}

/**
 * Retrieves the preview value for a specific sub-block.
 *
 * @remarks
 * Only returns a value when in preview mode and subBlockValues are provided.
 * Returns `null` if the value is not found in the subblock values.
 *
 * @param config - The sub-block configuration
 * @param isPreview - Whether the component is in preview mode
 * @param subBlockValues - Optional record of sub-block values
 * @returns The preview value, `null` if not found, or `undefined` if not in preview
 */
const getPreviewValue = (
  config: SubBlockConfig,
  isPreview: boolean,
  subBlockValues?: Record<string, any>
): unknown => {
  if (!isPreview || !subBlockValues) return undefined
  return subBlockValues[config.id]?.value ?? null
}

/**
 * Renders the label with optional validation, description tooltips, and inline wand control.
 *
 * @remarks
 * Handles JSON validation indicators for code blocks, required field markers,
 * and AI generation (wand) input interface.
 *
 * @param config - The sub-block configuration defining the label content
 * @param isValidJson - Whether the JSON content is valid (for code blocks)
 * @param wandState - State and handlers for the AI wand feature
 * @param subBlockValues - Current values of all subblocks for evaluating conditional requirements
 * @returns The label JSX element, or `null` for switch types or when no title is defined
 */
const renderLabel = (
  config: SubBlockConfig,
  isValidJson: boolean,
  wandState: {
    isSearchActive: boolean
    searchQuery: string
    isWandEnabled: boolean
    isPreview: boolean
    isStreaming: boolean
    disabled: boolean
    onSearchClick: () => void
    onSearchBlur: () => void
    onSearchChange: (value: string) => void
    onSearchSubmit: () => void
    onSearchCancel: () => void
    searchInputRef: React.RefObject<HTMLInputElement | null>
  },
  subBlockValues?: Record<string, any>
): JSX.Element | null => {
  if (config.type === 'switch') return null
  if (!config.title) return null

  const {
    isSearchActive,
    searchQuery,
    isWandEnabled,
    isPreview,
    isStreaming,
    disabled,
    onSearchClick,
    onSearchBlur,
    onSearchChange,
    onSearchSubmit,
    onSearchCancel,
    searchInputRef,
  } = wandState

  const required = isFieldRequired(config, subBlockValues)

  return (
    <Label className='flex items-center justify-between gap-[6px] pl-[2px]'>
      <div className='flex items-center gap-[6px] whitespace-nowrap'>
        {config.title}
        {required && <span className='ml-0.5'>*</span>}
        {config.type === 'code' && config.language === 'json' && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <AlertTriangle
                className={cn(
                  'h-4 w-4 cursor-pointer text-destructive',
                  !isValidJson ? 'opacity-100' : 'opacity-0'
                )}
              />
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              <p>Invalid JSON</p>
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>

      {/* Wand inline prompt */}
      {isWandEnabled && !isPreview && !disabled && (
        <div className='flex min-w-0 flex-1 items-center justify-end pr-[4px]'>
          {!isSearchActive ? (
            <Button
              variant='ghost'
              className='h-[12px] w-[12px] flex-shrink-0 p-0 hover:bg-transparent'
              aria-label='Generate with AI'
              onClick={onSearchClick}
            >
              <Wand2 className='!h-[12px] !w-[12px] bg-transparent text-[var(--text-secondary)]' />
            </Button>
          ) : (
            <input
              ref={searchInputRef}
              type='text'
              value={isStreaming ? 'Generating...' : searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onBlur={onSearchBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery.trim() && !isStreaming) {
                  onSearchSubmit()
                } else if (e.key === 'Escape') {
                  onSearchCancel()
                }
              }}
              disabled={isStreaming}
              className={cn(
                'h-[12px] w-full min-w-[100px] border-none bg-transparent py-0 pr-[2px] text-right font-medium text-[12px] text-[var(--text-primary)] leading-[14px] placeholder:text-[var(--text-muted)] focus:outline-none',
                isStreaming && 'text-muted-foreground'
              )}
              placeholder='Describe...'
            />
          )}
        </div>
      )}
    </Label>
  )
}

/**
 * Compares props to prevent unnecessary re-renders.
 *
 * @remarks
 * Used with React.memo to optimize performance by skipping re-renders
 * when props haven't meaningfully changed.
 *
 * @param prevProps - Previous component props
 * @param nextProps - Next component props
 * @returns `true` if props are equal and re-render should be skipped
 */
const arePropsEqual = (prevProps: SubBlockProps, nextProps: SubBlockProps): boolean => {
  return (
    prevProps.blockId === nextProps.blockId &&
    prevProps.config === nextProps.config &&
    prevProps.isPreview === nextProps.isPreview &&
    prevProps.subBlockValues === nextProps.subBlockValues &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.fieldDiffStatus === nextProps.fieldDiffStatus &&
    prevProps.allowExpandInPreview === nextProps.allowExpandInPreview
  )
}

/**
 * Renders a single workflow sub-block input based on config.type.
 *
 * @remarks
 * Supports multiple input types including short-input, long-input, dropdown,
 * combobox, slider, table, code, switch, tool-input, and many more.
 * Handles preview mode, disabled states, and AI wand generation.
 *
 * @param blockId - The parent block identifier
 * @param config - Configuration defining the input type and properties
 * @param isPreview - Whether to render in preview mode
 * @param subBlockValues - Current values of all subblocks
 * @param disabled - Whether the input is disabled
 * @param fieldDiffStatus - Optional diff status for visual indicators
 * @param allowExpandInPreview - Whether to allow expanding in preview mode
 * @returns The rendered sub-block input component
 */
function SubBlockComponent({
  blockId,
  config,
  isPreview = false,
  subBlockValues,
  disabled = false,
  fieldDiffStatus,
  allowExpandInPreview,
}: SubBlockProps): JSX.Element {
  const [isValidJson, setIsValidJson] = useState(true)
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wandControlRef = useRef<WandControlHandlers | null>(null)

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation()
  }

  const handleValidationChange = (isValid: boolean): void => {
    setIsValidJson(isValid)
  }

  // Check if wand is enabled for this sub-block
  const isWandEnabled = config.wandConfig?.enabled ?? false

  /**
   * Handles wand icon click to activate inline prompt mode.
   * Focuses the input after a brief delay to ensure DOM is ready.
   */
  const handleSearchClick = (): void => {
    setIsSearchActive(true)
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }

  /**
   * Handles search input blur event.
   * Deactivates the search mode if the query is empty and not currently streaming.
   */
  const handleSearchBlur = (): void => {
    if (!searchQuery.trim() && !wandControlRef.current?.isWandStreaming) {
      setIsSearchActive(false)
    }
  }

  /**
   * Handles search query change.
   *
   * @param value - The new search query value
   */
  const handleSearchChange = (value: string): void => {
    setSearchQuery(value)
  }

  /**
   * Handles search submit to trigger AI generation.
   * Clears the query and deactivates search mode after submission.
   */
  const handleSearchSubmit = (): void => {
    if (searchQuery.trim() && wandControlRef.current) {
      wandControlRef.current.onWandTrigger(searchQuery)
      setSearchQuery('')
      setIsSearchActive(false)
    }
  }

  /**
   * Handles search cancel to exit AI prompt mode.
   * Clears the query and deactivates search mode.
   */
  const handleSearchCancel = (): void => {
    setSearchQuery('')
    setIsSearchActive(false)
  }

  const previewValue = getPreviewValue(config, isPreview, subBlockValues) as
    | string
    | string[]
    | null
    | undefined

  // Use dependsOn gating to compute final disabled state
  // Only pass previewContextValues when in preview mode to avoid format mismatches
  const { finalDisabled: gatedDisabled } = useDependsOnGate(blockId, config, {
    disabled,
    isPreview,
    previewContextValues: isPreview ? subBlockValues : undefined,
  })

  const isDisabled = gatedDisabled

  /**
   * Selects and renders the appropriate input component based on config.type.
   *
   * @remarks
   * Maps the config type to the corresponding input component with all
   * necessary props. Falls back to an error message for unknown types.
   *
   * @returns The appropriate input component JSX element
   */
  const renderInput = (): JSX.Element => {
    switch (config.type) {
      case 'short-input':
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            password={config.password}
            readOnly={config.readOnly}
            showCopyButton={config.showCopyButton}
            useWebhookUrl={config.useWebhookUrl}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue as string | null | undefined}
            disabled={isDisabled}
            wandControlRef={wandControlRef}
            hideInternalWand={true}
          />
        )

      case 'long-input':
        return (
          <LongInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            rows={config.rows}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
            wandControlRef={wandControlRef}
            hideInternalWand={true}
          />
        )

      case 'dropdown':
        return (
          <div onMouseDown={handleMouseDown}>
            <Dropdown
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as { label: string; id: string }[]}
              defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
              placeholder={config.placeholder}
              isPreview={isPreview}
              previewValue={previewValue}
              disabled={isDisabled}
              multiSelect={config.multiSelect}
              fetchOptions={config.fetchOptions}
              fetchOptionById={config.fetchOptionById}
              dependsOn={config.dependsOn}
              searchable={config.searchable}
            />
          </div>
        )

      case 'combobox':
        return (
          <div onMouseDown={handleMouseDown}>
            <ComboBox
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as { label: string; id: string }[]}
              defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
              placeholder={config.placeholder}
              isPreview={isPreview}
              previewValue={previewValue as any}
              disabled={isDisabled}
              config={config}
              fetchOptions={config.fetchOptions}
              fetchOptionById={config.fetchOptionById}
              dependsOn={config.dependsOn}
            />
          </div>
        )

      case 'slider':
        return (
          <SliderInput
            blockId={blockId}
            subBlockId={config.id}
            min={config.min}
            max={config.max}
            defaultValue={(config.min || 0) + ((config.max || 100) - (config.min || 0)) / 2}
            step={config.step}
            integer={config.integer}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'table':
        return (
          <Table
            blockId={blockId}
            subBlockId={config.id}
            columns={config.columns ?? []}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'code':
        return (
          <Code
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            language={config.language}
            generationType={config.generationType}
            value={
              typeof config.value === 'function' ? config.value(subBlockValues || {}) : undefined
            }
            isPreview={isPreview}
            previewValue={previewValue as string | null | undefined}
            disabled={isDisabled}
            readOnly={config.readOnly}
            collapsible={config.collapsible}
            defaultCollapsed={config.defaultCollapsed}
            defaultValue={config.defaultValue}
            showCopyButton={config.showCopyButton}
            onValidationChange={handleValidationChange}
            wandConfig={
              config.wandConfig || {
                enabled: false,
                prompt: '',
                placeholder: '',
              }
            }
            wandControlRef={wandControlRef}
            hideInternalWand={true}
          />
        )

      case 'switch':
        return (
          <Switch
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'tool-input':
        return (
          <ToolInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={allowExpandInPreview ? false : isDisabled}
            allowExpandInPreview={allowExpandInPreview}
          />
        )

      case 'checkbox-list':
        return (
          <CheckboxList
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            options={config.options as { label: string; id: string }[]}
            isPreview={isPreview}
            subBlockValues={subBlockValues}
            disabled={isDisabled}
          />
        )

      case 'grouped-checkbox-list':
        return (
          <GroupedCheckboxList
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            options={config.options as { label: string; id: string; group?: string }[]}
            isPreview={isPreview}
            subBlockValues={subBlockValues ?? {}}
            disabled={isDisabled}
            maxHeight={config.maxHeight}
          />
        )

      case 'condition-input':
        return (
          <ConditionInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'router-input':
        return (
          <ConditionInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
            mode='router'
          />
        )

      case 'eval-input':
        return (
          <EvalInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'time-input':
        return (
          <TimeInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'file-upload':
        return (
          <FileUpload
            blockId={blockId}
            subBlockId={config.id}
            acceptedTypes={config.acceptedTypes || '*'}
            multiple={config.multiple === true}
            maxSize={config.maxSize}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'schedule-info':
        return <ScheduleInfo blockId={blockId} isPreview={isPreview} />

      case 'oauth-input':
        return (
          <CredentialSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )

      case 'file-selector':
        return (
          <FileSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={isPreview ? subBlockValues : undefined}
          />
        )

      case 'project-selector':
        return (
          <ProjectSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )

      case 'folder-selector':
        return (
          <FolderSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )

      case 'knowledge-base-selector':
        return (
          <KnowledgeBaseSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue as any}
          />
        )

      case 'knowledge-tag-filters':
        return (
          <KnowledgeTagFilters
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue as any}
          />
        )

      case 'document-tag-entry':
        return (
          <DocumentTagEntry
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue as any}
          />
        )

      case 'document-selector':
        return (
          <DocumentSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue as any}
          />
        )

      case 'input-format':
        return (
          <InputFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
            config={config}
            showValue={true}
          />
        )

      case 'input-mapping':
        return (
          <InputMapping
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'variables-input':
        return (
          <VariablesInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      case 'response-format':
        return (
          <ResponseFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            config={config}
            disabled={isDisabled}
          />
        )

      case 'channel-selector':
      case 'user-selector':
        return (
          <SlackSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )

      case 'mcp-server-selector':
        return (
          <McpServerSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue as any}
          />
        )

      case 'mcp-tool-selector':
        return (
          <McpToolSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue as any}
          />
        )

      case 'mcp-dynamic-args':
        return (
          <McpDynamicArgs
            blockId={blockId}
            subBlockId={config.id}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )

      case 'text':
        return (
          <Text
            blockId={blockId}
            subBlockId={config.id}
            content={
              typeof config.value === 'function'
                ? config.value(subBlockValues || {})
                : (config.defaultValue as string) || ''
            }
          />
        )
      case 'trigger-save':
        return (
          <TriggerSave
            blockId={blockId}
            subBlockId={config.id}
            triggerId={config.triggerId}
            isPreview={isPreview}
            disabled={disabled}
          />
        )

      case 'messages-input':
        return (
          <MessagesInput
            blockId={blockId}
            subBlockId={config.id}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
          />
        )

      default:
        return <div>Unknown input type: {config.type}</div>
    }
  }

  return (
    <div onMouseDown={handleMouseDown} className='subblock-content flex flex-col gap-[10px]'>
      {renderLabel(
        config,
        isValidJson,
        {
          isSearchActive,
          searchQuery,
          isWandEnabled,
          isPreview,
          isStreaming: wandControlRef.current?.isWandStreaming ?? false,
          disabled: isDisabled,
          onSearchClick: handleSearchClick,
          onSearchBlur: handleSearchBlur,
          onSearchChange: handleSearchChange,
          onSearchSubmit: handleSearchSubmit,
          onSearchCancel: handleSearchCancel,
          searchInputRef,
        },
        subBlockValues
      )}
      {renderInput()}
    </div>
  )
}

export const SubBlock = memo(SubBlockComponent, arePropsEqual)
