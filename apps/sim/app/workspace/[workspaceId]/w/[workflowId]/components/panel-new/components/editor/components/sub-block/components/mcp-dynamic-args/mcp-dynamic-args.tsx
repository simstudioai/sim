import { useCallback, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { formatParameterLabel } from '@/tools/params'

const logger = createLogger('McpDynamicArgs')

interface McpInputWithTagsProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  isPassword?: boolean
  blockId: string
  accessiblePrefixes?: Set<string>
}

function McpInputWithTags({
  value,
  onChange,
  placeholder,
  disabled,
  isPassword,
  blockId,
  accessiblePrefixes,
}: McpInputWithTagsProps) {
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    onChange(newValue)
    setCursorPosition(newCursorPosition)

    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const dropPosition = inputRef.current?.selectionStart ?? value.length ?? 0
      const currentValue = value ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      onChange(newValue)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      if (data.connectionData?.sourceBlockId) {
        setActiveSourceBlockId(data.connectionData.sourceBlockId)
      }

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = dropPosition + 1
          inputRef.current.selectionEnd = dropPosition + 1
        }
      }, 0)
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()
  }

  const handleTagSelect = (newValue: string) => {
    onChange(newValue)
    setShowTags(false)
    setActiveSourceBlockId(null)
  }

  return (
    <div className='relative'>
      <div className='relative'>
        <Input
          ref={inputRef}
          type={isPassword ? 'password' : 'text'}
          value={value || ''}
          onChange={handleChange}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete='off'
          className={cn(!isPassword && 'text-transparent caret-foreground')}
        />
        {!isPassword && (
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
            <div className='whitespace-pre'>
              {formatDisplayText(value?.toString() || '', {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
          </div>
        )}
      </div>
      <TagDropdown
        visible={showTags}
        onSelect={handleTagSelect}
        blockId={blockId}
        activeSourceBlockId={activeSourceBlockId}
        inputValue={value?.toString() ?? ''}
        cursorPosition={cursorPosition}
        onClose={() => {
          setShowTags(false)
          setActiveSourceBlockId(null)
        }}
      />
    </div>
  )
}

interface McpTextareaWithTagsProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  blockId: string
  accessiblePrefixes?: Set<string>
  rows?: number
}

function McpTextareaWithTags({
  value,
  onChange,
  placeholder,
  disabled,
  blockId,
  accessiblePrefixes,
  rows = 4,
}: McpTextareaWithTagsProps) {
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    onChange(newValue)
    setCursorPosition(newCursorPosition)

    // Check for tag trigger
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const dropPosition = textareaRef.current?.selectionStart ?? value.length ?? 0
      const currentValue = value ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      onChange(newValue)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      if (data.connectionData?.sourceBlockId) {
        setActiveSourceBlockId(data.connectionData.sourceBlockId)
      }

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = dropPosition + 1
          textareaRef.current.selectionEnd = dropPosition + 1
        }
      }, 0)
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
  }

  const handleTagSelect = (newValue: string) => {
    onChange(newValue)
    setShowTags(false)
    setActiveSourceBlockId(null)
  }

  return (
    <div className='relative'>
      <Textarea
        ref={textareaRef}
        value={value || ''}
        onChange={handleChange}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={cn('min-h-[80px] resize-none text-transparent caret-foreground')}
      />
      <div className='pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-3 text-sm'>
        {formatDisplayText(value || '', {
          accessiblePrefixes,
          highlightAll: !accessiblePrefixes,
        })}
      </div>
      <TagDropdown
        visible={showTags}
        onSelect={handleTagSelect}
        blockId={blockId}
        activeSourceBlockId={activeSourceBlockId}
        inputValue={value?.toString() ?? ''}
        cursorPosition={cursorPosition}
        onClose={() => {
          setShowTags(false)
          setActiveSourceBlockId(null)
        }}
      />
    </div>
  )
}

interface McpDynamicArgsProps {
  blockId: string
  subBlockId: string
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any
}

export function McpDynamicArgs({
  blockId,
  subBlockId,
  disabled = false,
  isPreview = false,
  previewValue,
}: McpDynamicArgsProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { mcpTools, isLoading } = useMcpTools(workspaceId)
  const [selectedTool] = useSubBlockValue(blockId, 'tool')
  const [cachedSchema] = useSubBlockValue(blockId, '_toolSchema')
  const [toolArgs, setToolArgs] = useSubBlockValue(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const selectedToolConfig = mcpTools.find((tool) => tool.id === selectedTool)
  const toolSchema = cachedSchema || selectedToolConfig?.inputSchema

  const currentArgs = useCallback(() => {
    if (isPreview && previewValue) {
      if (typeof previewValue === 'string') {
        try {
          return JSON.parse(previewValue)
        } catch (error) {
          console.warn('Failed to parse preview value as JSON:', error)
          return previewValue
        }
      }
      return previewValue
    }
    if (typeof toolArgs === 'string') {
      try {
        return JSON.parse(toolArgs)
      } catch (error) {
        console.warn('Failed to parse toolArgs as JSON:', error)
        return {}
      }
    }
    return toolArgs || {}
  }, [toolArgs, previewValue, isPreview])

  const updateParameter = useCallback(
    (paramName: string, value: any) => {
      if (disabled) return

      const current = currentArgs()
      // Store the value as-is, preserving types (number, boolean, etc.)
      const updated = { ...current, [paramName]: value }
      setToolArgs(updated)
    },
    [currentArgs, setToolArgs, disabled]
  )

  const getInputType = (paramSchema: any) => {
    if (paramSchema.enum) return 'dropdown'
    if (paramSchema.type === 'boolean') return 'switch'
    if (paramSchema.type === 'number' || paramSchema.type === 'integer') {
      if (paramSchema.minimum !== undefined && paramSchema.maximum !== undefined) {
        return 'slider'
      }
      return 'short-input'
    }
    if (paramSchema.type === 'string') {
      if (paramSchema.format === 'date-time') return 'short-input'
      if (paramSchema.maxLength && paramSchema.maxLength > 100) return 'long-input'
      return 'short-input'
    }
    if (paramSchema.type === 'array') return 'long-input'
    return 'short-input'
  }

  const renderParameterInput = (paramName: string, paramSchema: any) => {
    const current = currentArgs()
    const value = current[paramName]
    const inputType = getInputType(paramSchema)

    switch (inputType) {
      case 'switch':
        return (
          <div key={`${paramName}-switch`} className='flex items-center space-x-3'>
            <Switch
              id={`${paramName}-switch`}
              checked={!!value}
              onCheckedChange={(checked) => updateParameter(paramName, checked)}
              disabled={disabled}
            />
            <Label
              htmlFor={`${paramName}-switch`}
              className='cursor-pointer font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              {formatParameterLabel(paramName)}
            </Label>
          </div>
        )

      case 'dropdown':
        return (
          <div key={`${paramName}-dropdown`}>
            <Select
              value={value || ''}
              onValueChange={(selectedValue) => updateParameter(paramName, selectedValue)}
              disabled={disabled}
            >
              <SelectTrigger className='w-full'>
                <SelectValue
                  placeholder={`Select ${formatParameterLabel(paramName).toLowerCase()}`}
                />
              </SelectTrigger>
              <SelectContent>
                {paramSchema.enum?.map((option: any) => (
                  <SelectItem key={String(option)} value={String(option)}>
                    {String(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )

      case 'slider': {
        const minValue = paramSchema.minimum ?? 0
        const maxValue = paramSchema.maximum ?? 100
        const currentValue = value ?? minValue
        const normalizedPosition = ((currentValue - minValue) / (maxValue - minValue)) * 100

        return (
          <div key={`${paramName}-slider`} className='relative pt-2 pb-6'>
            <Slider
              value={[currentValue]}
              min={minValue}
              max={maxValue}
              step={paramSchema.type === 'integer' ? 1 : 0.1}
              onValueChange={(newValue) =>
                updateParameter(
                  paramName,
                  paramSchema.type === 'integer' ? Math.round(newValue[0]) : newValue[0]
                )
              }
              disabled={disabled}
              className='[&_[class*=SliderTrack]]:h-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4'
            />
            <div
              className='absolute text-muted-foreground text-sm'
              style={{
                left: `clamp(0%, ${normalizedPosition}%, 100%)`,
                transform: 'translateX(-50%)',
                top: '24px',
              }}
            >
              {paramSchema.type === 'integer'
                ? Math.round(currentValue).toString()
                : Number(currentValue).toFixed(1)}
            </div>
          </div>
        )
      }

      case 'long-input':
        return (
          <McpTextareaWithTags
            key={`${paramName}-long`}
            value={value || ''}
            onChange={(newValue) => updateParameter(paramName, newValue)}
            placeholder={
              paramSchema.type === 'array'
                ? `Enter JSON array, e.g. ["item1", "item2"] or comma-separated values`
                : paramSchema.description ||
                  `Enter ${formatParameterLabel(paramName).toLowerCase()}`
            }
            disabled={disabled}
            blockId={blockId}
            accessiblePrefixes={accessiblePrefixes}
            rows={4}
          />
        )

      default: {
        const isPassword =
          paramSchema.format === 'password' ||
          paramName.toLowerCase().includes('password') ||
          paramName.toLowerCase().includes('token')
        const isNumeric = paramSchema.type === 'number' || paramSchema.type === 'integer'

        return (
          <McpInputWithTags
            key={`${paramName}-short`}
            value={value?.toString() || ''}
            onChange={(newValue) => {
              let processedValue: any = newValue
              const hasTag = newValue.includes('<') || newValue.includes('>')

              if (isNumeric && processedValue !== '' && !hasTag) {
                processedValue =
                  paramSchema.type === 'integer'
                    ? Number.parseInt(processedValue)
                    : Number.parseFloat(processedValue)

                if (Number.isNaN(processedValue)) {
                  processedValue = ''
                }
              }
              updateParameter(paramName, processedValue)
            }}
            placeholder={
              paramSchema.type === 'array'
                ? `Enter JSON array, e.g. ["item1", "item2"] or comma-separated values`
                : paramSchema.description ||
                  `Enter ${formatParameterLabel(paramName).toLowerCase()}`
            }
            disabled={disabled}
            isPassword={isPassword}
            blockId={blockId}
            accessiblePrefixes={accessiblePrefixes}
          />
        )
      }
    }
  }

  if (!selectedTool) {
    return (
      <div className='rounded-lg border border-dashed p-8 text-center'>
        <p className='text-muted-foreground text-sm'>Select a tool to configure its parameters</p>
      </div>
    )
  }

  if (
    selectedTool &&
    !cachedSchema &&
    !selectedToolConfig &&
    (isLoading || mcpTools.length === 0)
  ) {
    return (
      <div className='rounded-lg border border-dashed p-8 text-center'>
        <p className='text-muted-foreground text-sm'>Loading tool schema...</p>
      </div>
    )
  }

  if (!toolSchema?.properties || Object.keys(toolSchema.properties).length === 0) {
    return (
      <div className='rounded-lg border border-dashed p-8 text-center'>
        <p className='text-muted-foreground text-sm'>This tool requires no parameters</p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {toolSchema.properties &&
        Object.entries(toolSchema.properties).map(([paramName, paramSchema]) => {
          const inputType = getInputType(paramSchema as any)
          const showLabel = inputType !== 'switch'

          return (
            <div key={paramName} className='space-y-2'>
              {showLabel && (
                <Label
                  className={cn(
                    'font-medium text-sm',
                    toolSchema.required?.includes(paramName) &&
                      'after:ml-1 after:text-red-500 after:content-["*"]'
                  )}
                >
                  {formatParameterLabel(paramName)}
                </Label>
              )}
              {renderParameterInput(paramName, paramSchema as any)}
            </div>
          )
        })}
    </div>
  )
}
