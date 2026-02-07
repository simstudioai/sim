import { type JSX, type MouseEvent, memo, useCallback, useRef, useState } from 'react'
import { isEqual } from 'lodash'
import { AlertTriangle, ArrowLeftRight, ArrowUp, Check, Clipboard } from 'lucide-react'
import { Button, Input, Label, Tooltip } from '@/components/emcn/components'
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
  SheetSelectorInput,
  ShortInput,
  SkillInput,
  SlackSelectorInput,
  SliderInput,
  Switch,
  Table,
  Text,
  TimeInput,
  ToolInput,
  VariablesInput,
  WorkflowSelectorInput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import type { SubBlockConfig } from '@/blocks/types'
import { useWebhookManagement } from '@/hooks/use-webhook-management'

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
  canonicalToggle?: {
    mode: 'basic' | 'advanced'
    disabled?: boolean
    onToggle?: () => void
  }
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
 * Renders the label with optional validation and description tooltips.
 *
 * @remarks
 * Handles JSON validation indicators for code blocks and required field markers.
 * Includes inline AI generate button when wand is enabled.
 *
 * @param config - The sub-block configuration defining the label content
 * @param isValidJson - Whether the JSON content is valid (for code blocks)
 * @param subBlockValues - Current values of all subblocks for evaluating conditional requirements
 * @param wandState - Optional state and handlers for the AI wand feature
 * @param canonicalToggle - Optional canonical toggle metadata and handlers
 * @param canonicalToggleIsDisabled - Whether the canonical toggle is disabled
 * @returns The label JSX element, or `null` for switch types or when no title is defined
 */
const renderLabel = (
  config: SubBlockConfig,
  isValidJson: boolean,
  subBlockValues?: Record<string, any>,
  wandState?: {
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
  canonicalToggle?: {
    mode: 'basic' | 'advanced'
    disabled?: boolean
    onToggle?: () => void
  },
  canonicalToggleIsDisabled?: boolean,
  copyState?: {
    showCopyButton: boolean
    copied: boolean
    onCopy: () => void
  }
): JSX.Element | null => {
  if (config.type === 'switch') return null
  if (!config.title) return null

  const required = isFieldRequired(config, subBlockValues)
  const showWand = wandState?.isWandEnabled && !wandState.isPreview && !wandState.disabled
  const showCanonicalToggle = !!canonicalToggle && !wandState?.isPreview
  const showCopy = copyState?.showCopyButton && !wandState?.isPreview
  const canonicalToggleDisabledResolved = canonicalToggleIsDisabled ?? canonicalToggle?.disabled

  return (
    <div className='flex items-center justify-between gap-[6px] pl-[2px]'>
      <Label className='flex items-center gap-[6px] whitespace-nowrap'>
        {config.title}
        {required && <span className='ml-0.5'>*</span>}
        {config.type === 'code' &&
          config.language === 'json' &&
          !isValidJson &&
          !wandState?.isStreaming && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className='inline-flex'>
                  <AlertTriangle className='h-3 w-3 flex-shrink-0 cursor-pointer text-destructive' />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>Invalid JSON</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
      </Label>
      <div className='flex min-w-0 flex-1 items-center justify-end gap-[6px]'>
        {showCopy && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type='button'
                onClick={copyState.onCopy}
                className='-my-1 flex h-5 w-5 items-center justify-center'
                aria-label='Copy value'
              >
                {copyState.copied ? (
                  <Check className='h-3 w-3 text-green-500' />
                ) : (
                  <Clipboard className='h-3 w-3 text-muted-foreground' />
                )}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              <p>{copyState.copied ? 'Copied!' : 'Copy'}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        )}
        {showWand && (
          <>
            {!wandState.isSearchActive ? (
              <Button
                variant='active'
                className='-my-1 h-5 px-2 py-0 text-[11px]'
                onClick={wandState.onSearchClick}
              >
                Generate
              </Button>
            ) : (
              <div className='-my-1 flex min-w-[120px] max-w-[280px] flex-1 items-center gap-[4px]'>
                <Input
                  ref={wandState.searchInputRef}
                  value={wandState.isStreaming ? 'Generating...' : wandState.searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    wandState.onSearchChange(e.target.value)
                  }
                  onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                    // Only close if clicking outside the input container (not on the submit button)
                    const relatedTarget = e.relatedTarget as HTMLElement | null
                    if (relatedTarget?.closest('button')) return
                    wandState.onSearchBlur()
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (
                      e.key === 'Enter' &&
                      wandState.searchQuery.trim() &&
                      !wandState.isStreaming
                    ) {
                      wandState.onSearchSubmit()
                    } else if (e.key === 'Escape') {
                      wandState.onSearchCancel()
                    }
                  }}
                  disabled={wandState.isStreaming}
                  className={cn(
                    'h-5 min-w-[80px] flex-1 text-[11px]',
                    wandState.isStreaming && 'text-muted-foreground'
                  )}
                  placeholder='Generate with AI...'
                />
                <Button
                  variant='tertiary'
                  disabled={!wandState.searchQuery.trim() || wandState.isStreaming}
                  onMouseDown={(e: React.MouseEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    wandState.onSearchSubmit()
                  }}
                  className='h-[20px] w-[20px] flex-shrink-0 p-0'
                >
                  <ArrowUp className='h-[12px] w-[12px]' />
                </Button>
              </div>
            )}
          </>
        )}
        {showCanonicalToggle && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type='button'
                className='flex h-[12px] w-[12px] flex-shrink-0 items-center justify-center bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50'
                onClick={canonicalToggle?.onToggle}
                disabled={canonicalToggleDisabledResolved}
                aria-label={
                  canonicalToggle?.mode === 'advanced'
                    ? 'Switch to selector'
                    : 'Switch to manual ID'
                }
              >
                <ArrowLeftRight
                  className={cn(
                    '!h-[12px] !w-[12px]',
                    canonicalToggle?.mode === 'advanced'
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  )}
                />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              <p>
                {canonicalToggle?.mode === 'advanced'
                  ? 'Switch to selector'
                  : 'Switch to manual ID'}
              </p>
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
    </div>
  )
}

/**
 * Compares props for memo equality check.
 *
 * @param prevProps - Previous component props
 * @param nextProps - Next component props
 * @returns `true` if props are equal and re-render should be skipped
 */
const arePropsEqual = (prevProps: SubBlockProps, nextProps: SubBlockProps): boolean => {
  const subBlockId = prevProps.config.id
  const prevValue = prevProps.subBlockValues?.[subBlockId]?.value
  const nextValue = nextProps.subBlockValues?.[subBlockId]?.value

  const valueEqual = prevValue === nextValue || isEqual(prevValue, nextValue)

  const configEqual =
    prevProps.config.id === nextProps.config.id && prevProps.config.type === nextProps.config.type

  const canonicalToggleEqual =
    !!prevProps.canonicalToggle === !!nextProps.canonicalToggle &&
    prevProps.canonicalToggle?.mode === nextProps.canonicalToggle?.mode &&
    prevProps.canonicalToggle?.disabled === nextProps.canonicalToggle?.disabled

  return (
    prevProps.blockId === nextProps.blockId &&
    configEqual &&
    prevProps.isPreview === nextProps.isPreview &&
    valueEqual &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.fieldDiffStatus === nextProps.fieldDiffStatus &&
    prevProps.allowExpandInPreview === nextProps.allowExpandInPreview &&
    canonicalToggleEqual
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
  canonicalToggle,
}: SubBlockProps): JSX.Element {
  const [isValidJson, setIsValidJson] = useState(true)
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wandControlRef = useRef<WandControlHandlers | null>(null)

  // Use webhook management hook when config has useWebhookUrl enabled
  const webhookManagement = useWebhookManagement({
    blockId,
    triggerId: undefined,
    isPreview,
    useWebhookUrl: config.useWebhookUrl,
  })

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation()
  }

  const handleValidationChange = (isValid: boolean): void => {
    setIsValidJson(isValid)
  }

  const isWandEnabled = config.wandConfig?.enabled ?? false

  /**
   * Handles copying the webhook URL to clipboard.
   */
  const handleCopy = useCallback(() => {
    const textToCopy = webhookManagement?.webhookUrl
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [webhookManagement?.webhookUrl])

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

      case 'skill-input':
        return (
          <SkillInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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

      case 'sheet-selector':
        return (
          <SheetSelectorInput
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
          />
        )

      case 'workflow-selector':
        return (
          <WorkflowSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue as string | null}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
            previewContextValues={isPreview ? subBlockValues : undefined}
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
      case 'messages-input':
        return (
          <MessagesInput
            blockId={blockId}
            subBlockId={config.id}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue as any}
            disabled={isDisabled}
            wandControlRef={wandControlRef}
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
        subBlockValues,
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
        canonicalToggle,
        Boolean(canonicalToggle?.disabled || disabled || isPreview),
        {
          showCopyButton: Boolean(config.showCopyButton && config.useWebhookUrl),
          copied,
          onCopy: handleCopy,
        }
      )}
      {renderInput()}
    </div>
  )
}

export const SubBlock = memo(SubBlockComponent, arePropsEqual)
