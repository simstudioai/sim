import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
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

  // Validate current arguments against schema (but don't show error - asterisk already indicates required)
  useEffect(() => {
    if (!toolSchema?.properties || !toolArgs) return

    try {
      const parsed = currentArgs()
      const required = toolSchema.required || []
      const missing = required.filter(
        (req: string) =>
          !Object.hasOwn(parsed, req) || parsed[req] === undefined || parsed[req] === ''
      )

      // We don't show the error message anymore since asterisk already indicates required fields
      setError(null)
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

    // Custom props that override the default useSubBlockValue behavior
    // We manage all parameters in a single JSON field, not separate fields
    const commonProps = {
      blockId,
      subBlockId: paramName, // This is ignored since we override with custom onChange
      disabled,
      isPreview: true, // Force preview mode to use our custom values
      previewValue: value,
    }

    switch (inputType) {
      case 'switch':
        return (
          <div key={`${paramName}-switch`}>
            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={!!value}
                onChange={(e) => updateParameter(paramName, e.target.checked)}
                disabled={disabled}
                className='sr-only'
              />
              <div
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  value ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    value ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </div>
              <span className='text-sm'>{formatParameterLabel(paramName)}</span>
            </label>
          </div>
        )

      case 'dropdown':
        return (
          <div key={`${paramName}-dropdown`}>
            <select
              value={value || ''}
              onChange={(e) => updateParameter(paramName, e.target.value)}
              disabled={disabled}
              className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <option value=''>{`Select ${formatParameterLabel(paramName).toLowerCase()}`}</option>
              {paramSchema.enum?.map((option: any) => (
                <option key={String(option)} value={String(option)}>
                  {String(option)}
                </option>
              ))}
            </select>
          </div>
        )

      case 'slider':
        return (
          <div key={`${paramName}-slider`} className='space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='text-sm'>{formatParameterLabel(paramName)}</span>
              <span className='text-gray-500 text-sm'>{value || paramSchema.minimum || 0}</span>
            </div>
            <input
              type='range'
              min={paramSchema.minimum || 0}
              max={paramSchema.maximum || 100}
              step={paramSchema.type === 'integer' ? 1 : 0.1}
              value={value || paramSchema.minimum || 0}
              onChange={(e) =>
                updateParameter(
                  paramName,
                  paramSchema.type === 'integer'
                    ? Number.parseInt(e.target.value)
                    : Number.parseFloat(e.target.value)
                )
              }
              disabled={disabled}
              className='w-full'
            />
          </div>
        )

      case 'long-input':
        return (
          <div key={`${paramName}-long`}>
            <textarea
              value={value || ''}
              onChange={(e) => updateParameter(paramName, e.target.value)}
              placeholder={
                paramSchema.description || `Enter ${formatParameterLabel(paramName).toLowerCase()}`
              }
              disabled={disabled}
              rows={4}
              className='flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
            />
          </div>
        )

      default: {
        const isPassword =
          paramName.toLowerCase().includes('password') || paramName.toLowerCase().includes('token')
        return (
          <div key={`${paramName}-short`}>
            <Input
              type={isPassword ? 'password' : 'text'}
              value={value || ''}
              onChange={(e) => updateParameter(paramName, e.target.value)}
              placeholder={
                paramSchema.description || `Enter ${formatParameterLabel(paramName).toLowerCase()}`
              }
              disabled={disabled}
            />
          </div>
        )
      }
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
