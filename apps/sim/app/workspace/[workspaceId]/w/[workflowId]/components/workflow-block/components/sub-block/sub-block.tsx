import { useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getBlock } from '@/blocks/index'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { ChannelSelectorInput } from './components/channel-selector/channel-selector-input'
import { CheckboxList } from './components/checkbox-list'
import { Code } from './components/code'
import { ComboBox } from './components/combobox'
import { ConditionInput } from './components/condition-input'
import { CredentialSelector } from './components/credential-selector/credential-selector'
import { DateInput } from './components/date-input'
import { DocumentSelector } from './components/document-selector/document-selector'
import { Dropdown } from './components/dropdown'
import { EvalInput } from './components/eval-input'
import { FileSelectorInput } from './components/file-selector/file-selector-input'
import { FileUpload } from './components/file-upload'
import { FolderSelectorInput } from './components/folder-selector/components/folder-selector-input'
import { KnowledgeBaseSelector } from './components/knowledge-base-selector/knowledge-base-selector'
import { LongInput } from './components/long-input'
import { ProjectSelectorInput } from './components/project-selector/project-selector-input'
import { ResponseFormat } from './components/response/response-format'
import { ScheduleConfig } from './components/schedule/schedule-config'
import { ShortInput } from './components/short-input'
import { SliderInput } from './components/slider-input'
import { InputFormat } from './components/starter/input-format'
import { Switch } from './components/switch'
import { Table } from './components/table'
import { TimeInput } from './components/time-input'
import { ToolInput } from './components/tool-input/tool-input'
import { WebhookConfig } from './components/webhook/webhook'

interface SubBlockProps {
  blockId: string
  config: SubBlockConfig
  isConnecting: boolean
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

export function SubBlock({
  blockId,
  config,
  isConnecting,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: SubBlockProps) {
  const [isValidJson, setIsValidJson] = useState(true)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleValidationChange = (isValid: boolean) => {
    setIsValidJson(isValid)
  }

  const isFieldRequired = () => {
    const blockType = useWorkflowStore.getState().blocks[blockId]?.type
    if (!blockType) return false

    const blockConfig = getBlock(blockType)
    if (!blockConfig) return false

    return blockConfig.inputs[config.id]?.required === true
  }

  // Get preview value for this specific sub-block
  const getPreviewValue = () => {
    if (!isPreview || !subBlockValues) return undefined
    return subBlockValues[config.id]?.value ?? null
  }

  const renderInput = () => {
    const previewValue = getPreviewValue()
    // Disable input if explicitly disabled or in preview mode
    const isDisabled = disabled || isPreview

    switch (config.type) {
      case 'short-input':
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            password={config.password}
            isConnecting={isConnecting}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'long-input':
        return (
          <LongInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            isConnecting={isConnecting}
            rows={config.rows}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'dropdown':
        return (
          <div onMouseDown={handleMouseDown}>
            <Dropdown
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as { label: string; id: string }[]}
              isPreview={isPreview}
              previewValue={previewValue}
              disabled={isDisabled}
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
              placeholder={config.placeholder}
              isPreview={isPreview}
              previewValue={previewValue}
              disabled={isDisabled}
              isConnecting={isConnecting}
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
            previewValue={previewValue}
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
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'code':
        return (
          <Code
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            placeholder={config.placeholder}
            language={config.language}
            generationType={config.generationType}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            onValidationChange={handleValidationChange}
          />
        )
      case 'switch':
        return (
          <Switch
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            isPreview={isPreview}
            previewValue={previewValue}
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
            layout={config.layout}
            isPreview={isPreview}
            subBlockValues={subBlockValues}
            disabled={isDisabled}
          />
        )
      case 'condition-input':
        return (
          <ConditionInput
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'eval-input':
        return (
          <EvalInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'date-input':
        return (
          <DateInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            isPreview={isPreview}
            previewValue={previewValue}
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
            previewValue={previewValue}
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
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'webhook-config': {
        // For webhook config, we need to construct the value from multiple subblock values
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
            isConnecting={isConnecting}
            isPreview={isPreview}
            value={webhookValue}
            disabled={isDisabled}
          />
        )
      }
      case 'schedule-config':
        return (
          <ScheduleConfig
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
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
            previewValue={previewValue}
          />
        )
      case 'document-selector':
        return (
          <DocumentSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'input-format': {
        return (
          <InputFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      }
      case 'response-format':
        return (
          <ResponseFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
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
      default:
        return <div>Unknown input type: {config.type}</div>
    }
  }

  const required = isFieldRequired()

  return (
    <div className='space-y-[6px] pt-[2px]' onMouseDown={handleMouseDown}>
      {config.type !== 'switch' && (
        <Label className='flex items-center gap-1'>
          {config.title}
          {required && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='cursor-help text-red-500'>*</span>
              </TooltipTrigger>
              <TooltipContent side='top'>
                <p>This field is required</p>
              </TooltipContent>
            </Tooltip>
          )}
          {config.id === 'responseFormat' && !isValidJson && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className='h-4 w-4 cursor-pointer text-destructive' />
              </TooltipTrigger>
              <TooltipContent side='top'>
                <p>Invalid JSON</p>
              </TooltipContent>
            </Tooltip>
          )}
          {config.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className='h-4 w-4 cursor-pointer text-muted-foreground' />
              </TooltipTrigger>
              <TooltipContent side='top' className='max-w-[400px] select-text whitespace-pre-wrap'>
                {config.description.split('\n').map((line, idx) => (
                  <p
                    key={idx}
                    className={idx === 0 ? 'mb-1 text-sm' : 'text-muted-foreground text-xs'}
                  >
                    {line}
                  </p>
                ))}
              </TooltipContent>
            </Tooltip>
          )}
        </Label>
      )}
      {renderInput()}
    </div>
  )
}
