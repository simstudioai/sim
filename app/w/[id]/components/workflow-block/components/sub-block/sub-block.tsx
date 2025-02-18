import { Label } from '@/components/ui/label'
import { SubBlockConfig } from '../../../../../../../blocks/types'
import { CheckboxList } from './components/checkbox-list'
import { Code } from './components/code'
import { ConditionInput } from './components/condition-input'
import { Dropdown } from './components/dropdown'
import { EvalInput } from './components/eval-input'
import { LongInput } from './components/long-input'
import { ShortInput } from './components/short-input'
import { SliderInput } from './components/slider-input'
import { Switch } from './components/switch'
import { Table } from './components/table'
import { ToolInput } from './components/tool-input'

interface SubBlockProps {
  blockId: string
  config: SubBlockConfig
  isConnecting: boolean
}

export function SubBlock({ blockId, config, isConnecting }: SubBlockProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
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
          />
        )
      case 'table':
        return <Table blockId={blockId} subBlockId={config.id} columns={config.columns ?? []} />
      case 'code':
        return <Code blockId={blockId} subBlockId={config.id} isConnecting={isConnecting} />
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
      default:
        return null
    }
  }

  return (
    <div className="space-y-1" onMouseDown={handleMouseDown}>
      {config.type !== 'switch' && <Label>{config.title}</Label>}
      {renderInput()}
    </div>
  )
}
