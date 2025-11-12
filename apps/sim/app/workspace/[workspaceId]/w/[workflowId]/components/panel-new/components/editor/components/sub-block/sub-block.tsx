import { type JSX, type MouseEvent, memo, useRef, useState } from 'react'
import { AlertTriangle, Wand2 } from 'lucide-react'
import { Label, Tooltip } from '@/components/emcn/components'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FieldDiffStatus } from '@/lib/workflows/diff/types'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-depends-on-gate'
import type { SubBlockConfig } from '@/blocks/types'
import {
  ChannelSelectorInput,
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
  ProjectSelectorInput,
  ResponseFormat,
  ScheduleSave,
  ShortInput,
  SliderInput,
  Switch,
  Table,
  Text,
  TimeInput,
  ToolInput,
  TriggerSave,
  VariablesInput,
  WebhookConfig,
} from './components'

/**
 * Interface for wand control handlers exposed by sub-block inputs
 */
export interface WandControlHandlers {
  onWandTrigger: (prompt: string) => void
  isWandActive: boolean
  isWandStreaming: boolean
}

/**
 * Props for the `SubBlock` UI element. Renders a single configurable input within a workflow block.
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
 * Returns whether the field is required for validation. Intentionally unused.
 * @param config - The sub-block configuration
 * @returns True if the field is required
 */
const isFieldRequired = (config: SubBlockConfig): boolean => {
  return config.required === true
}

/**
 * Retrieves the preview value for a specific sub-block.
 * @param config - The sub-block configuration
 * @param isPreview - Whether the component is in preview mode
 * @param subBlockValues - Optional record of sub-block values
 * @returns The preview value or undefined
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
 * @param config - The sub-block configuration
 * @param isValidJson - Whether the JSON is valid
 * @param wandState - Wand interaction state
 * @returns The label JSX element or null if no title or for switch types
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
    onSearchClick: () => void
    onSearchBlur: () => void
    onSearchChange: (value: string) => void
    onSearchSubmit: () => void
    onSearchCancel: () => void
    searchInputRef: React.RefObject<HTMLInputElement | null>
  }
): JSX.Element | null => {
  if (config.type === 'switch') return null
  if (!config.title) return null

  const {
    isSearchActive,
    searchQuery,
    isWandEnabled,
    isPreview,
    isStreaming,
    onSearchClick,
    onSearchBlur,
    onSearchChange,
    onSearchSubmit,
    onSearchCancel,
    searchInputRef,
  } = wandState

  return (
    <Label className='flex items-center justify-between gap-[6px] pl-[2px]'>
      <div className='flex items-center gap-[6px] whitespace-nowrap'>
        {config.title}
        {config.id === 'responseFormat' && (
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
      {isWandEnabled && !isPreview && (
        <div className='flex items-center pr-[4px]'>
          {!isSearchActive ? (
            <Button
              variant='ghost'
              className='h-[12px] w-[12px] p-0 hover:bg-transparent'
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
                'h-[12px] w-full max-w-[200px] border-none bg-transparent py-0 pr-[2px] text-right font-medium text-[12px] text-[var(--text-primary)] leading-[14px] placeholder:text-[#737373] focus:outline-none dark:text-[var(--text-primary)]',
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
 * @param prevProps - Previous component props
 * @param nextProps - Next component props
 * @returns True if props are equal (skip re-render)
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
 * Renders a single workflow sub-block input based on `config.type`, supporting preview and disabled states.
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
   * Handle wand icon click to activate inline prompt mode
   */
  const handleSearchClick = (): void => {
    setIsSearchActive(true)
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }

  /**
   * Handle search input blur - deactivate if empty and not streaming
   */
  const handleSearchBlur = (): void => {
    if (!searchQuery.trim() && !wandControlRef.current?.isWandStreaming) {
      setIsSearchActive(false)
    }
  }

  /**
   * Handle search query change
   */
  const handleSearchChange = (value: string): void => {
    setSearchQuery(value)
  }

  /**
   * Handle search submit - trigger generation
   */
  const handleSearchSubmit = (): void => {
    if (searchQuery.trim() && wandControlRef.current) {
      wandControlRef.current.onWandTrigger(searchQuery)
      setSearchQuery('')
      setIsSearchActive(false)
    }
  }

  /**
   * Handle search cancel
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
  const { finalDisabled: gatedDisabled } = useDependsOnGate(blockId, config, {
    disabled,
    isPreview,
    previewContextValues: subBlockValues,
  })

  const isDisabled = gatedDisabled

  /**
   * Selects and renders the appropriate input component for the current sub-block `config.type`.
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
              dependsOn={config.dependsOn}
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

      case 'webhook-config': {
        const webhookValue =
          isPreview && subBlockValues
            ? {
                webhookProvider: subBlockValues.webhookProvider?.value,
                webhookPath: subBlockValues.webhookPath?.value,
                providerConfig: subBlockValues.providerConfig?.value,
              }
            : previewValue

        return (
          <WebhookConfig
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            value={webhookValue as any}
            disabled={isDisabled}
          />
        )
      }

      case 'schedule-save':
        return <ScheduleSave blockId={blockId} isPreview={isPreview} disabled={disabled} />

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
            previewContextValues={subBlockValues}
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
        return (
          <ChannelSelectorInput
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

      default:
        return <div>Unknown input type: {config.type}</div>
    }
  }

  return (
    <div onMouseDown={handleMouseDown} className='flex flex-col gap-[10px]'>
      {renderLabel(config, isValidJson, {
        isSearchActive,
        searchQuery,
        isWandEnabled,
        isPreview,
        isStreaming: wandControlRef.current?.isWandStreaming ?? false,
        onSearchClick: handleSearchClick,
        onSearchBlur: handleSearchBlur,
        onSearchChange: handleSearchChange,
        onSearchSubmit: handleSearchSubmit,
        onSearchCancel: handleSearchCancel,
        searchInputRef,
      })}
      {renderInput()}
    </div>
  )
}

export const SubBlock = memo(SubBlockComponent, arePropsEqual)
