import { useCallback, useState } from 'react'
import { Combobox, FieldDivider, Label, Slider, Switch } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { LongInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/long-input/long-input'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input/short-input'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpTools } from '@/hooks/mcp/use-mcp-tools'
import { formatParameterLabel } from '@/tools/params'

const logger = createLogger('McpDynamicArgs')

/**
 * The dropdown UI renders each enum member as a string label/value, so it can only
 * represent JSON Schema enums whose members are primitives — a non-primitive member
 * (object/array) would collapse to "[object Object]" and lose its identity. Callers
 * route a non-primitive enum to the JSON editor (`long-input`) instead.
 */
function isPrimitiveEnum(
  enumValues: unknown
): enumValues is Array<string | number | boolean | null> {
  return (
    Array.isArray(enumValues) &&
    enumValues.every((value) => value === null || typeof value !== 'object')
  )
}

/**
 * True when the schema's actual value must be a JSON object/array (a plain
 * object/array type, or a non-primitive enum member) rather than a string.
 */
function requiresJsonValue(paramSchema: any): boolean {
  return (
    paramSchema.type === 'object' ||
    paramSchema.type === 'array' ||
    (Array.isArray(paramSchema.enum) && !isPrimitiveEnum(paramSchema.enum))
  )
}

/**
 * Stable signature of an entire tool schema, for detecting whether the effective
 * param shape has changed (independent of object identity). Signs the whole schema
 * rather than cherry-picking fields (e.g. just `properties`) so a refresh that only
 * changes `required`, or any other schema-level field, isn't silently missed.
 */
function schemaSignature(schema: unknown): string {
  return schema ? JSON.stringify(schema) : ''
}

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
  const activeSearchTarget = useActiveSearchTarget()
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

  /**
   * Draft text for JSON-value params (object/array/non-primitive-enum) whose current
   * edit isn't valid JSON yet, paired with a signature of the persisted value it was
   * typed against. Keeping this out of toolArgs means the stored argument is always
   * either the last valid parsed value or untouched — never malformed text that could
   * reach tool execution. A draft is only displayed while its baseline still matches
   * the live persisted value, so an external change to that value (undo/redo, a diff
   * baseline switch, a collaborator's edit) can't be shadowed by stale draft text.
   * Drafts also reset wholesale whenever the selected tool or either schema source
   * changes — `toolSchema` prefers the cached `_toolSchema` snapshot over the live
   * discovered schema, so the reset key tracks both independently rather than the
   * resolved `toolSchema`, which wouldn't change on a live-only refresh.
   */
  const [invalidJsonDrafts, setInvalidJsonDrafts] = useState<
    Record<string, { text: string; baseline: string }>
  >({})
  const draftResetKey = `${selectedTool ?? ''}|${schemaSignature(cachedSchema)}|${schemaSignature(selectedToolConfig?.inputSchema)}`
  const [prevDraftResetKey, setPrevDraftResetKey] = useState(draftResetKey)
  if (prevDraftResetKey !== draftResetKey) {
    setPrevDraftResetKey(draftResetKey)
    setInvalidJsonDrafts({})
  }

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
    if (Array.isArray(paramSchema.enum)) {
      return isPrimitiveEnum(paramSchema.enum) ? 'dropdown' : 'long-input'
    }
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
    if (paramSchema.type === 'array' || paramSchema.type === 'object') return 'long-input'
    return 'short-input'
  }

  const renderParameterInput = (paramName: string, paramSchema: any) => {
    const current = currentArgs()
    const value = current[paramName]
    const inputType = getInputType(paramSchema)

    switch (inputType) {
      case 'switch':
        return (
          <div key={`${paramName}-switch`} className='flex items-center gap-x-3'>
            <Switch
              id={`${paramName}-switch`}
              checked={!!value}
              onCheckedChange={(checked) => updateParameter(paramName, checked)}
              disabled={disabled}
            />
            <Label
              htmlFor={`${paramName}-switch`}
              className='cursor-pointer font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              {formatParameterLabel(paramName)}
            </Label>
          </div>
        )

      case 'dropdown': {
        const dropdownOptions = (paramSchema.enum || []).map((option: any) => ({
          label: String(option),
          value: String(option),
        }))
        const selectedLabel = value ? String(value) : ''
        const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
          activeSearchTarget,
          blockId,
          subBlockId,
          valuePath: [paramName],
          label: selectedLabel,
        })

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
              overlayContent={
                workflowSearchHighlight ? (
                  <span className='truncate text-[var(--text-primary)]'>
                    {formatDisplayText(selectedLabel, { workflowSearchHighlight })}
                  </span>
                ) : undefined
              }
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
        const needsJsonValue = requiresJsonValue(paramSchema)
        const valueSignature = JSON.stringify(value ?? null)
        const draft = invalidJsonDrafts[paramName]
        const activeDraft =
          needsJsonValue && draft && draft.baseline === valueSignature ? draft.text : undefined
        const displayValue =
          activeDraft !== undefined
            ? activeDraft
            : typeof value === 'string' || value == null
              ? value || ''
              : JSON.stringify(value)
        return (
          <LongInput
            key={`${paramName}-long`}
            blockId={blockId}
            subBlockId={subBlockId}
            config={config}
            placeholder={config.placeholder}
            rows={4}
            value={displayValue}
            onChange={(newValue) => {
              if (!needsJsonValue) {
                updateParameter(paramName, newValue)
                return
              }
              const clearDraft = () =>
                setInvalidJsonDrafts((prev) => {
                  if (!(paramName in prev)) return prev
                  const { [paramName]: _removed, ...rest } = prev
                  return rest
                })
              if (newValue === '') {
                updateParameter(paramName, '')
                clearDraft()
                return
              }
              try {
                updateParameter(paramName, JSON.parse(newValue))
                clearDraft()
              } catch {
                setInvalidJsonDrafts((prev) => ({
                  ...prev,
                  [paramName]: { text: newValue, baseline: valueSignature },
                }))
              }
            }}
            isPreview={isPreview}
            disabled={disabled}
            workflowSearchValuePath={[paramName]}
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
            subBlockId={subBlockId}
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
            workflowSearchValuePath={[paramName]}
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
        <p className='text-muted-foreground text-sm'>Loading tool schema…</p>
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
                <div className='subblock-content flex flex-col gap-2.5'>
                  {showLabel && (
                    <div className='flex items-center justify-between gap-1.5 pl-0.5'>
                      <Label className='flex items-baseline gap-1.5 whitespace-nowrap'>
                        {formatParameterLabel(paramName)}
                        {toolSchema.required?.includes(paramName) && (
                          <span className='ml-0.5'>*</span>
                        )}
                      </Label>
                    </div>
                  )}
                  {renderParameterInput(paramName, paramSchema as any)}
                </div>
                {showDivider && <FieldDivider subblockMarker />}
              </div>
            )
          })}
      </div>
    </div>
  )
}
