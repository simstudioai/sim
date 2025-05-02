import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getBlock } from '@/blocks/index'
import { SubBlockConfig } from '@/blocks/types'
import { CheckboxList } from './components/checkbox-list'
import { Code } from './components/code'
import { ConditionInput } from './components/condition-input'
import { CredentialSelector } from './components/credential-selector/credential-selector'
import { DateInput } from './components/date-input'
import { Dropdown } from './components/dropdown'
import { EvalInput } from './components/eval-input'
import { FileSelectorInput } from './components/file-selector/file-selector-input'
import { FileUpload } from './components/file-upload'
import { FolderSelectorInput } from './components/folder-selector/components/folder-selector-input'
import { LongInput } from './components/long-input'
import { ProjectSelectorInput } from './components/project-selector/project-selector-input'
import { ScheduleConfig } from './components/schedule/schedule-config'
import { ShortInput } from './components/short-input'
import { SliderInput } from './components/slider-input'
import { InputFormat } from './components/starter/input-format'
import { Switch } from './components/switch'
import { Table } from './components/table'
import { TimeInput } from './components/time-input'
import { ToolInput } from './components/tool-input/tool-input'
import { WebhookConfig } from './components/webhook/webhook-config'
import { Info } from 'lucide-react'

interface SubBlockProps {
  blockId: string
  config: SubBlockConfig
  isConnecting: boolean
}

export function SubBlock({ blockId, config, isConnecting }: SubBlockProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const { getValue } = useSubBlockStore()

  const isFieldRequired = () => {
    const blockType = useWorkflowStore.getState().blocks[blockId]?.type
    if (!blockType) return false

    const blockConfig = getBlock(blockType)
    if (!blockConfig) return false

    return blockConfig.inputs[config.id]?.required === true
  }

  const renderInput = () => {
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
          />
        )
      case 'long-input':
        return (
          <LongInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            isConnecting={isConnecting}
            config={config}
          />
        )
      case 'dropdown':
        return (
          <div onMouseDown={handleMouseDown}>
            <Dropdown
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as string[]}
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
          />
        )
      case 'table':
        return <Table blockId={blockId} subBlockId={config.id} columns={config.columns ?? []} />
      case 'code':
        return (
          <Code
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            placeholder={config.placeholder}
            language={config.language}
            generationType={config.generationType}
          />
        )
      case 'switch':
        return <Switch blockId={blockId} subBlockId={config.id} title={config.title ?? ''} />
      case 'tool-input':
        return <ToolInput blockId={blockId} subBlockId={config.id} />
      case 'checkbox-list':
        return (
          <CheckboxList
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            options={config.options as { label: string; id: string }[]}
            layout={config.layout}
          />
        )
      case 'condition-input':
        return (
          <ConditionInput blockId={blockId} subBlockId={config.id} isConnecting={isConnecting} />
        )
      case 'eval-input':
        return <EvalInput blockId={blockId} subBlockId={config.id} />
      case 'date-input':
        return (
          <DateInput blockId={blockId} subBlockId={config.id} placeholder={config.placeholder} />
        )
      case 'time-input':
        return (
          <TimeInput blockId={blockId} subBlockId={config.id} placeholder={config.placeholder} />
        )
      case 'file-upload':
        return (
          <FileUpload
            blockId={blockId}
            subBlockId={config.id}
            acceptedTypes={config.acceptedTypes || '*'}
            multiple={config.multiple === true}
            maxSize={config.maxSize}
          />
        )
      case 'webhook-config':
        return (
          <WebhookConfig blockId={blockId} subBlockId={config.id} isConnecting={isConnecting} />
        )
      case 'schedule-config':
        return (
          <ScheduleConfig blockId={blockId} subBlockId={config.id} isConnecting={isConnecting} />
        )
      case 'oauth-input':
        return (
          <CredentialSelector
            value={typeof config.value === 'string' ? config.value : ''}
            onChange={(value) => {
              // Use the workflow store to update the value
              const event = new CustomEvent('update-subblock-value', {
                detail: {
                  blockId,
                  subBlockId: config.id,
                  value,
                },
              })
              window.dispatchEvent(event)
            }}
            provider={config.provider as any}
            requiredScopes={config.requiredScopes || []}
            label={config.placeholder || 'Select a credential'}
            serviceId={config.serviceId}
          />
        )
      case 'file-selector':
        return <FileSelectorInput blockId={blockId} subBlock={config} disabled={isConnecting} />
      case 'project-selector':
        return <ProjectSelectorInput blockId={blockId} subBlock={config} disabled={isConnecting} />
      case 'folder-selector':
        return <FolderSelectorInput blockId={blockId} subBlock={config} disabled={isConnecting} />
      case 'input-format':
        return <InputFormat blockId={blockId} subBlockId={config.id} />
      default:
        return <div>Unknown input type: {config.type}</div>
    }
  }

  const required = isFieldRequired()

  return (
    <div className="space-y-1" onMouseDown={handleMouseDown}>
      {config.type !== 'switch' && (
        <Label className="flex items-center gap-1">
          {config.title}
          {required && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-red-500 cursor-help">*</span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>This field is required</p>
              </TooltipContent>
            </Tooltip>
          )}
          {config.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[400px] select-text whitespace-pre-wrap">
                {config.description.split('\n').map((line, idx) => (
                  <p
                    key={idx}
                    className={idx === 0 ? 'text-sm mb-1' : 'text-xs text-muted-foreground'}
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
