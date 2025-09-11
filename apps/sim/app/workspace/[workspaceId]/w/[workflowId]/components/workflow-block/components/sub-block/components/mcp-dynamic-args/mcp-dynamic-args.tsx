import { useCallback } from 'react'
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
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { formatParameterLabel } from '@/tools/params'

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
  const { mcpTools } = useMcpTools(workspaceId)
  const [selectedTool] = useSubBlockValue(blockId, 'tool')
  const [toolArgs, setToolArgs] = useSubBlockValue(blockId, subBlockId)

  const selectedToolConfig = mcpTools.find((tool) => tool.id === selectedTool)
  const toolSchema = selectedToolConfig?.inputSchema

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
    (paramName: string, value: any, paramSchema?: any) => {
      if (disabled) return

      const current = currentArgs()
      // Store the value as-is, without processing
      const updated = { ...current, [paramName]: value }
      const jsonString = JSON.stringify(updated, null, 2)
      setToolArgs(jsonString)
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
              onCheckedChange={(checked) => updateParameter(paramName, checked, paramSchema)}
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
              onValueChange={(selectedValue) =>
                updateParameter(paramName, selectedValue, paramSchema)
              }
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

      case 'slider':
        return (
          <div key={`${paramName}-slider`} className='relative pt-2 pb-6'>
            <Slider
              value={[value || paramSchema.minimum || 0]}
              min={paramSchema.minimum || 0}
              max={paramSchema.maximum || 100}
              step={paramSchema.type === 'integer' ? 1 : 0.1}
              onValueChange={(newValue) =>
                updateParameter(
                  paramName,
                  paramSchema.type === 'integer' ? Math.round(newValue[0]) : newValue[0],
                  paramSchema
                )
              }
              disabled={disabled}
              className='[&_[class*=SliderTrack]]:h-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4'
            />
            <div
              className='absolute text-muted-foreground text-sm'
              style={{
                left: `clamp(0%, ${(((value || paramSchema.minimum || 0) - (paramSchema.minimum || 0)) / ((paramSchema.maximum || 100) - (paramSchema.minimum || 0))) * 100}%, 100%)`,
                transform: 'translateX(-50%)',
                top: '24px',
              }}
            >
              {paramSchema.type === 'integer'
                ? Math.round(value || paramSchema.minimum || 0).toString()
                : Number(value || paramSchema.minimum || 0).toFixed(1)}
            </div>
          </div>
        )

      case 'long-input':
        return (
          <div key={`${paramName}-long`}>
            <Textarea
              value={value || ''}
              onChange={(e) => updateParameter(paramName, e.target.value, paramSchema)}
              placeholder={
                paramSchema.type === 'array'
                  ? `Enter JSON array, e.g. ["item1", "item2"] or comma-separated values`
                  : paramSchema.description ||
                    `Enter ${formatParameterLabel(paramName).toLowerCase()}`
              }
              disabled={disabled}
              rows={4}
              className='min-h-[80px] resize-none'
            />
          </div>
        )

      default: {
        const isPassword =
          paramSchema.format === 'password' ||
          paramName.toLowerCase().includes('password') ||
          paramName.toLowerCase().includes('token')
        const isNumeric = paramSchema.type === 'number' || paramSchema.type === 'integer'

        return (
          <div key={`${paramName}-short`}>
            <Input
              type={isPassword ? 'password' : isNumeric ? 'number' : 'text'}
              value={value || ''}
              onChange={(e) => {
                let processedValue: any = e.target.value
                if (isNumeric && processedValue !== '') {
                  processedValue =
                    paramSchema.type === 'integer'
                      ? Number.parseInt(processedValue)
                      : Number.parseFloat(processedValue)

                  if (Number.isNaN(processedValue)) {
                    processedValue = ''
                    return
                  }
                }
                updateParameter(paramName, processedValue, paramSchema)
              }}
              placeholder={
                paramSchema.type === 'array'
                  ? `Enter JSON array, e.g. ["item1", "item2"] or comma-separated values`
                  : paramSchema.description ||
                    `Enter ${formatParameterLabel(paramName).toLowerCase()}`
              }
              disabled={disabled}
            />
          </div>
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

  if (!toolSchema?.properties || Object.keys(toolSchema.properties).length === 0) {
    return (
      <div className='rounded-lg border border-dashed p-8 text-center'>
        <p className='text-muted-foreground text-sm'>This tool requires no parameters</p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {Object.entries(toolSchema.properties).map(([paramName, paramSchema]) => {
        const inputType = getInputType(paramSchema as any)
        const showLabel = inputType !== 'switch' // Switch component includes its own label

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
