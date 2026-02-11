import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { Combobox, Label, Slider, Switch } from '@/components/emcn/components'
import { cn } from '@/lib/core/utils/cn'
import { LongInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/long-input/long-input'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input/short-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpTools } from '@/hooks/mcp/use-mcp-tools'
import { formatParameterLabel } from '@/tools/params'

const logger = createLogger('McpDynamicArgs')

interface McpDynamicArgsProps {
  blockId: string
  subBlockId: string
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any
  previewContextValues?: Record<string, unknown>
}

/**
 * Creates a minimal SubBlockConfig for MCP tool parameters
 */
function createParamConfig(
  paramName: string,
  paramSchema: any,
  inputType: 'long-input' | 'short-input'
): SubBlockConfig {
  const placeholder =
    paramSchema.type === 'array'
      ? `Enter JSON array, e.g. ["item1", "item2"] or comma-separated values`
      : paramSchema.description || `Enter ${formatParameterLabel(paramName).toLowerCase()}`

  return {
    id: paramName,
    type: inputType,
    title: formatParameterLabel(paramName),
    placeholder,
  }
}

export function McpDynamicArgs({
  blockId,
  subBlockId,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: McpDynamicArgsProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { mcpTools, isLoading } = useMcpTools(workspaceId)
  const [toolFromStore] = useSubBlockValue(blockId, 'tool')
  const selectedTool = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.tool)
    : toolFromStore
  const [schemaFromStore] = useSubBlockValue(blockId, '_toolSchema')
  const cachedSchema = previewContextValues
    ? resolvePreviewContextValue(previewContextValues._toolSchema)
    : schemaFromStore
  const [toolArgs, setToolArgs] = useSubBlockValue(blockId, subBlockId)

  const selectedToolConfig = mcpTools.find((tool) => tool.id === selectedTool)
  const toolSchema = cachedSchema || selectedToolConfig?.inputSchema

  const currentArgs = useCallback(() => {
    if (isPreview && previewValue) {
      if (typeof previewValue === 'string') {
        try {
          return JSON.parse(previewValue)
        } catch (error) {
          logger.warn('Failed to parse preview value as JSON:', { error })
          return previewValue
        }
      }
      return previewValue
    }
    if (typeof toolArgs === 'string') {
      try {
        return JSON.parse(toolArgs)
      } catch (error) {
        logger.warn('Failed to parse toolArgs as JSON:', { error })
        return {}
      }
    }
    return toolArgs || {}
  }, [toolArgs, previewValue, isPreview])

  const updateParameter = useCallback(
    (paramName: string, value: any) => {
      if (disabled) return

      const current = currentArgs()

      if (value === '' && (current[paramName] === undefined || current[paramName] === null)) {
        return
      }

      if (value === '') {
        const { [paramName]: _, ...rest } = current
        setToolArgs(Object.keys(rest).length > 0 ? rest : {})
        return
      }

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

      case 'dropdown': {
        const dropdownOptions = useMemo(
          () =>
            (paramSchema.enum || []).map((option: any) => ({
              label: String(option),
              value: String(option),
            })),
          [paramSchema.enum]
        )

        return (
          <div key={`${paramName}-dropdown`}>
            <Combobox
              options={dropdownOptions}
              value={value || ''}
              selectedValue={value || ''}
              onChange={(selectedValue) => {
                const matchedOption = dropdownOptions.find(
                  (opt: { label: string; value: string }) => opt.value === selectedValue
                )
                if (matchedOption) {
                  updateParameter(paramName, selectedValue)
                }
              }}
              placeholder={`Select ${formatParameterLabel(paramName).toLowerCase()}`}
              disabled={disabled}
              editable={false}
              filterOptions={true}
            />
          </div>
        )
      }

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

      case 'long-input': {
        const config = createParamConfig(paramName, paramSchema, 'long-input')
        return (
          <LongInput
            key={`${paramName}-long`}
            blockId={blockId}
            subBlockId={`_mcp_${paramName}`}
            config={config}
            placeholder={config.placeholder}
            rows={4}
            value={value || ''}
            onChange={(newValue) => updateParameter(paramName, newValue)}
            isPreview={isPreview}
            disabled={disabled}
          />
        )
      }

      default: {
        const isPassword =
          paramSchema.format === 'password' ||
          paramName.toLowerCase().includes('password') ||
          paramName.toLowerCase().includes('token')
        const isNumeric = paramSchema.type === 'number' || paramSchema.type === 'integer'
        const config = createParamConfig(paramName, paramSchema, 'short-input')

        return (
          <ShortInput
            key={`${paramName}-short`}
            blockId={blockId}
            subBlockId={`_mcp_${paramName}`}
            config={config}
            placeholder={config.placeholder}
            password={isPassword}
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
            isPreview={isPreview}
            disabled={disabled}
          />
        )
      }
    }
  }

  if (!selectedTool) {
    return (
      <div className='rounded-lg border p-8 text-center'>
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
      <div className='rounded-lg border p-8 text-center'>
        <p className='text-muted-foreground text-sm'>Loading tool schema...</p>
      </div>
    )
  }

  if (!toolSchema?.properties || Object.keys(toolSchema.properties).length === 0) {
    return (
      <div className='rounded-lg border p-8 text-center'>
        <p className='text-muted-foreground text-sm'>This tool requires no parameters</p>
      </div>
    )
  }

  return (
    <div className='relative'>
      {/* Hidden dummy inputs to prevent browser password manager autofill */}
      <input
        type='text'
        name='fakeusernameremembered'
        autoComplete='username'
        style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
        tabIndex={-1}
        readOnly
      />
      <input
        type='password'
        name='fakepasswordremembered'
        autoComplete='current-password'
        style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
        tabIndex={-1}
        readOnly
      />
      <input
        type='email'
        name='fakeemailremembered'
        autoComplete='email'
        style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
        tabIndex={-1}
        readOnly
      />
      <div>
        {toolSchema.properties &&
          Object.entries(toolSchema.properties).map(([paramName, paramSchema], index, entries) => {
            const inputType = getInputType(paramSchema as any)
            const showLabel = inputType !== 'switch'
            const showDivider = index < entries.length - 1

            return (
              <div key={paramName} className='subblock-row'>
                <div className='subblock-content flex flex-col gap-[10px]'>
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
                {showDivider && (
                  <div className='subblock-divider px-[2px] pt-[16px] pb-[13px]'>
                    <div
                      className='h-[1.25px]'
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
