import { useCallback, useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dropdown,
  LongInput,
  ShortInput,
  SliderInput,
  Switch,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components'
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
  const { mcpTools } = useMcpTools()
  const [selectedTool] = useSubBlockValue(blockId, 'tool') ?? [undefined, () => {}]
  const [toolArgs, setToolArgs] = useSubBlockValue(blockId, subBlockId)
  const [error, setError] = useState<string | null>(null)

  // Find the selected tool's schema
  // Note: selectedTool is the full tool ID (serverId-toolName), not just the name
  const selectedToolConfig = mcpTools.find((tool) => tool.id === selectedTool)
  const toolSchema = selectedToolConfig?.inputSchema

  // Parse current arguments
  const currentArgs = useCallback(() => {
    if (isPreview && previewValue) {
      return typeof previewValue === 'string' ? JSON.parse(previewValue) : previewValue
    }
    if (typeof toolArgs === 'string') {
      try {
        return JSON.parse(toolArgs)
      } catch {
        return {}
      }
    }
    return toolArgs || {}
  }, [toolArgs, previewValue, isPreview])

  // Update a specific parameter
  const updateParameter = useCallback(
    (paramName: string, value: any) => {
      if (disabled) return

      const current = currentArgs()
      const updated = { ...current, [paramName]: value }

      // Convert back to JSON string for storage
      const jsonString = JSON.stringify(updated, null, 2)
      setToolArgs(jsonString)
      setError(null)
    },
    [currentArgs, setToolArgs, disabled]
  )

  // Validate current arguments against schema
  useEffect(() => {
    if (!toolSchema?.properties || !toolArgs) return

    try {
      const parsed = currentArgs()
      const required = toolSchema.required || []
      const missing = required.filter(
        (req: string) =>
          !Object.hasOwn(parsed, req) || parsed[req] === undefined || parsed[req] === ''
      )

      if (missing.length > 0) {
        setError(`Missing required parameters: ${missing.join(', ')}`)
      } else {
        setError(null)
      }
    } catch (err) {
      setError('Invalid JSON format')
    }
  }, [toolArgs, toolSchema, currentArgs])

  // Render parameter input based on schema type
  const renderParameterInput = (paramName: string, paramSchema: any) => {
    const current = currentArgs()
    const value = current[paramName]
    const isRequired = toolSchema?.required?.includes(paramName)

    // Determine input type based on schema
    const getInputType = () => {
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
      if (paramSchema.type === 'array') return 'checkbox-list'
      return 'short-input'
    }

    const inputType = getInputType()

    const commonProps = {
      blockId,
      subBlockId: paramName,
      disabled,
      isPreview,
      previewValue: value,
    }

    switch (inputType) {
      case 'switch':
        return (
          <Switch
            {...commonProps}
            title={formatParameterLabel(paramName)}
            // Override the hook to use our custom update
            key={`${paramName}-switch`}
          />
        )

      case 'dropdown':
        return (
          <Dropdown
            {...commonProps}
            options={
              paramSchema.enum?.map((val: any) => ({ label: String(val), id: String(val) })) || []
            }
            placeholder={`Select ${formatParameterLabel(paramName).toLowerCase()}`}
            defaultValue={value}
            config={{
              id: paramName,
              type: 'dropdown',
              title: formatParameterLabel(paramName),
              required: isRequired,
            }}
            key={`${paramName}-dropdown`}
          />
        )

      case 'slider':
        return (
          <SliderInput
            {...commonProps}
            min={paramSchema.minimum || 0}
            max={paramSchema.maximum || 100}
            step={paramSchema.type === 'integer' ? 1 : 0.1}
            integer={paramSchema.type === 'integer'}
            defaultValue={value || paramSchema.minimum || 0}
            key={`${paramName}-slider`}
          />
        )

      case 'long-input':
        return (
          <LongInput
            {...commonProps}
            placeholder={
              paramSchema.description || `Enter ${formatParameterLabel(paramName).toLowerCase()}`
            }
            rows={4}
            config={{
              id: paramName,
              type: 'long-input',
              title: formatParameterLabel(paramName),
              required: isRequired,
            }}
            isConnecting={false}
            key={`${paramName}-long`}
          />
        )

      default:
        return (
          <ShortInput
            {...commonProps}
            placeholder={
              paramSchema.description || `Enter ${formatParameterLabel(paramName).toLowerCase()}`
            }
            password={
              paramName.toLowerCase().includes('password') ||
              paramName.toLowerCase().includes('token')
            }
            config={{
              id: paramName,
              type: 'short-input',
              title: formatParameterLabel(paramName),
              required: isRequired,
            }}
            isConnecting={false}
            key={`${paramName}-short`}
          />
        )
    }
  }

  // Show message when no tool is selected
  if (!selectedTool) {
    return (
      <div className='rounded-lg border border-gray-300 border-dashed p-8 text-center dark:border-gray-600'>
        <p className='text-muted-foreground text-sm'>Select a tool to configure its parameters</p>
      </div>
    )
  }

  // Show message when tool has no parameters
  if (!toolSchema?.properties || Object.keys(toolSchema.properties).length === 0) {
    return (
      <div className='rounded-lg border border-gray-300 border-dashed p-8 text-center dark:border-gray-600'>
        <p className='text-muted-foreground text-sm'>This tool requires no parameters</p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Error display */}
      {error && (
        <div className='flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-700 text-sm dark:bg-red-900/20 dark:text-red-400'>
          <AlertCircle className='h-4 w-4' />
          {error}
        </div>
      )}

      {/* Dynamic parameter inputs */}
      <div className='space-y-4'>
        {Object.entries(toolSchema.properties).map(([paramName, paramSchema]) => (
          <div key={paramName} className='space-y-2'>
            <div
              className={cn(
                'flex items-center gap-2 font-medium text-sm',
                toolSchema.required?.includes(paramName) && 'after:text-red-500 after:content-["*"]'
              )}
            >
              {formatParameterLabel(paramName)}
            </div>
            {renderParameterInput(paramName, paramSchema)}
          </div>
        ))}
      </div>
    </div>
  )
}
