'use client'

import { useState } from 'react'
import { SwitchField } from '@sim/emcn/field'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { isPlainRecord, omit } from '@sim/utils/object'
import { LongInput } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/long-input/long-input'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/mcp-dynamic-args/mcp-dynamic-args.module.css'
import { ShortInput } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import { RangeRow } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/slider-input/range-row'
import {
  resolvePreviewContextValue,
  type SubBlockConfig,
  useMcpBlockConfig,
  useSubBlockValue,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import {
  createMcpToolId,
  formatParameterLabel,
  type JsonSchemaProperty,
  jsonSchemaType,
  subBlockTypeForJsonSchema,
  useMcpToolsQuery,
} from '@/platform/lib/data/workflow-editor/mcp'

const ARRAY_PLACEHOLDER = 'Enter JSON array, e.g. ["item1", "item2"] or comma-separated values'
const JSON_ARGUMENTS_CONFIG: Pick<SubBlockConfig, 'type' | 'title' | 'placeholder'> = {
  type: 'long-input',
  title: 'JSON arguments',
  placeholder: 'JSON arguments or an upstream reference',
}

type ParamInputType = 'switch' | 'dropdown' | 'slider' | 'long-input' | 'short-input'

/** A JSON-value param's in-progress text that is not valid JSON yet, and the value it was typed over. */
interface JsonDraft {
  text: string
  baseline: string
}

/**
 * The dropdown can only represent enum members that are primitives; an object or array member
 * would collapse to "[object Object]", so such an enum goes to the JSON editor instead.
 */
function isPrimitiveEnum(
  enumValues: unknown
): enumValues is Array<string | number | boolean | null> {
  return (
    Array.isArray(enumValues) &&
    enumValues.every((value) => value === null || typeof value !== 'object')
  )
}

/** Whether the param's value must be a JSON object or array rather than a string. */
function requiresJsonValue(paramSchema: JsonSchemaProperty): boolean {
  const type = jsonSchemaType(paramSchema)
  return (
    type === 'object' ||
    type === 'array' ||
    (Array.isArray(paramSchema.enum) && !isPrimitiveEnum(paramSchema.enum))
  )
}

/** A stable signature of the whole schema, so a refresh that changes only `required` still counts. */
function schemaSignature(schema: unknown): string {
  return schema ? JSON.stringify(schema) : ''
}

/** An attempted JSON literal, as opposed to the comma-separated shorthand array params accept. */
function looksLikeJsonLiteral(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('[') || trimmed.startsWith('{')
}

/**
 * The control a schema property gets, from the same map an agent block's tool row uses. `code`
 * maps to the long input, which carries the JSON-draft handling this one-object store needs.
 */
function getInputType(paramSchema: JsonSchemaProperty): ParamInputType {
  const type = subBlockTypeForJsonSchema(paramSchema)
  if (type === 'code' || type === 'long-input') return 'long-input'
  if (type === 'switch' || type === 'dropdown' || type === 'slider') return type
  return 'short-input'
}

function createParamConfig(
  paramName: string,
  paramSchema: JsonSchemaProperty,
  inputType: 'long-input' | 'short-input'
): SubBlockConfig {
  const title = formatParameterLabel(paramName)
  const placeholder =
    jsonSchemaType(paramSchema) === 'array'
      ? ARRAY_PLACEHOLDER
      : typeof paramSchema.description === 'string' && paramSchema.description
        ? paramSchema.description
        : `Enter ${title.toLowerCase()}`
  return { id: paramName, type: inputType, title, placeholder }
}

/** The stored arguments as an object; JSON text is parsed and anything unreadable reads as empty. */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return isPlainRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return isPlainRecord(raw) ? raw : {}
}

function schemaProperties(schema: Record<string, unknown>): Array<[string, JsonSchemaProperty]> {
  const { properties } = schema
  if (!isPlainRecord(properties)) return []
  return Object.entries(properties).map(([name, property]) => [
    name,
    isPlainRecord(property) ? property : {},
  ])
}

function schemaRequired(schema: Record<string, unknown>): Set<string> {
  return new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : []
  )
}

function finiteOr(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toDisplayText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

interface McpDynamicArgsProps {
  blockId: string
  subBlockId: string
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
  previewContextValues?: Record<string, unknown>
}

/**
 * An MCP block's arguments, generated from the selected tool's input schema: each property gets
 * the control its type calls for, and all of them persist into one arguments object. In the
 * tool's advanced mode it is a single JSON field instead.
 */
export function McpDynamicArgs({
  blockId,
  subBlockId,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: McpDynamicArgsProps) {
  const { workspaceId } = useWorkflowScope()
  const { data: mcpTools, isLoading } = useMcpToolsQuery(workspaceId)
  const [schemaFromStore] = useSubBlockValue<unknown>(blockId, '_toolSchema')
  const {
    server: selectedServer,
    tool: selectedTool,
    argumentsMode,
  } = useMcpBlockConfig({ blockId, previewContextValues })
  const cachedSchema = previewContextValues
    ? resolvePreviewContextValue(previewContextValues._toolSchema)
    : schemaFromStore
  const [toolArgs, setToolArgs] = useSubBlockValue<unknown>(blockId, subBlockId)

  const selectedToolConfig = mcpTools.find(
    (tool) =>
      tool.serverId === selectedServer &&
      (createMcpToolId(tool.serverId, tool.name) === selectedTool || tool.name === selectedTool)
  )
  const rawSchema: unknown = selectedToolConfig?.inputSchema || cachedSchema
  const toolSchema = isPlainRecord(rawSchema) ? rawSchema : null

  // Invalid JSON text stays out of the stored arguments, so execution only sees the last valid
  // value; a draft shows only while its baseline matches the stored value, so undo or a
  // collaborator's edit wins. Drafts reset when the tool or cached schema changes, or when the
  // same tool's live schema changes to a different non-empty one (not the first load, and not a
  // refetch that briefly empties it).
  const [invalidJsonDrafts, setInvalidJsonDrafts] = useState<Record<string, JsonDraft>>({})
  const toolAndCachedSchemaKey = `${String(selectedTool ?? '')}|${schemaSignature(cachedSchema)}`
  const liveSchemaSignature = schemaSignature(selectedToolConfig?.inputSchema)
  const [prevToolAndCachedSchemaKey, setPrevToolAndCachedSchemaKey] =
    useState(toolAndCachedSchemaKey)
  const [lastNonEmptyLiveSchemaSignature, setLastNonEmptyLiveSchemaSignature] =
    useState(liveSchemaSignature)
  if (prevToolAndCachedSchemaKey !== toolAndCachedSchemaKey) {
    setInvalidJsonDrafts({})
    setPrevToolAndCachedSchemaKey(toolAndCachedSchemaKey)
    setLastNonEmptyLiveSchemaSignature(liveSchemaSignature)
  } else {
    const nextLastNonEmpty =
      liveSchemaSignature !== '' ? liveSchemaSignature : lastNonEmptyLiveSchemaSignature
    if (nextLastNonEmpty !== lastNonEmptyLiveSchemaSignature) {
      const isGenuineLiveRefresh =
        liveSchemaSignature !== '' &&
        lastNonEmptyLiveSchemaSignature !== '' &&
        liveSchemaSignature !== lastNonEmptyLiveSchemaSignature
      if (isGenuineLiveRefresh) setInvalidJsonDrafts({})
      setLastNonEmptyLiveSchemaSignature(nextLastNonEmpty)
    }
  }

  const currentArgs = isPreview && previewValue ? parseArgs(previewValue) : parseArgs(toolArgs)

  const updateParameter = (paramName: string, value: unknown) => {
    if (disabled || isPreview) return
    const isUnset = currentArgs[paramName] === undefined || currentArgs[paramName] === null
    if (value === '' && isUnset) return
    if (value === '') {
      setToolArgs(omit(currentArgs, [paramName]))
      return
    }
    setToolArgs({ ...currentArgs, [paramName]: value })
  }

  const clearDraft = (paramName: string) =>
    setInvalidJsonDrafts((prev) => (paramName in prev ? omit(prev, [paramName]) : prev))

  const renderParameterInput = (paramName: string, paramSchema: JsonSchemaProperty) => {
    const value = currentArgs[paramName]
    const label = formatParameterLabel(paramName)

    switch (getInputType(paramSchema)) {
      case 'switch':
        return (
          <SwitchField
            label={label}
            checked={!!value}
            disabled={disabled || isPreview}
            onCheckedChange={(checked) => updateParameter(paramName, checked)}
          />
        )

      case 'dropdown': {
        const members: unknown[] = Array.isArray(paramSchema.enum) ? paramSchema.enum : []
        // Presence of the key, not truthiness, decides the selection: `0`, `false` and a literal
        // `null` member are real selections.
        const selected = Object.hasOwn(currentArgs, paramName) ? String(value) : null
        return (
          <SearchableSelect
            label={label}
            labelHidden
            placeholder={`Select ${label.toLowerCase()}`}
            searchLabel={`Search ${label.toLowerCase()}`}
            options={members.map((member) => ({ value: String(member), label: String(member) }))}
            value={selected}
            selectedLabel={selected ?? undefined}
            onValueChange={(next) => {
              // Persist the enum member itself: writing the option's string would send '1' for 1,
              // 'true' for true and 'null' for null.
              const memberIndex = members.findIndex((member) => String(member) === next)
              if (memberIndex !== -1) updateParameter(paramName, members[memberIndex])
            }}
            disabled={disabled || isPreview}
          />
        )
      }

      case 'slider': {
        const isInteger = jsonSchemaType(paramSchema) === 'integer'
        const minValue = finiteOr(paramSchema.minimum, 0)
        const maxValue = finiteOr(paramSchema.maximum, 100)
        const currentValue =
          value === undefined || value === null ? minValue : finiteOr(value, minValue)
        return (
          <RangeRow
            label={label}
            min={minValue}
            max={maxValue}
            value={currentValue}
            integer={isInteger}
            disabled={disabled || isPreview}
            onValueChange={(next) => updateParameter(paramName, next)}
          />
        )
      }

      case 'long-input': {
        const config = createParamConfig(paramName, paramSchema, 'long-input')
        const needsJsonValue = requiresJsonValue(paramSchema)
        const valueSignature = JSON.stringify(value ?? null)
        const draft = invalidJsonDrafts[paramName]
        const activeDraft =
          needsJsonValue && draft && draft.baseline === valueSignature ? draft.text : undefined
        const displayValue = activeDraft ?? toDisplayText(value)
        return (
          <LongInput
            blockId={blockId}
            subBlockId={subBlockId}
            config={config}
            placeholder={config.placeholder}
            rows={4}
            value={displayValue}
            previewValue={isPreview ? displayValue : undefined}
            onChange={(newValue) => {
              if (!needsJsonValue) {
                updateParameter(paramName, newValue)
                return
              }
              if (newValue === '') {
                updateParameter(paramName, '')
                clearDraft(paramName)
                return
              }
              try {
                updateParameter(paramName, JSON.parse(newValue))
                clearDraft(paramName)
              } catch {
                if (jsonSchemaType(paramSchema) === 'array' && !looksLikeJsonLiteral(newValue)) {
                  updateParameter(paramName, newValue)
                  clearDraft(paramName)
                  return
                }
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
        const lowerName = paramName.toLowerCase()
        const isPassword =
          paramSchema.format === 'password' ||
          lowerName.includes('password') ||
          lowerName.includes('token')
        const numericType = jsonSchemaType(paramSchema)
        const isNumeric = numericType === 'number' || numericType === 'integer'
        const config = createParamConfig(paramName, paramSchema, 'short-input')
        const displayValue = value === undefined || value === null ? '' : String(value)
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={subBlockId}
            config={config}
            placeholder={config.placeholder}
            password={isPassword}
            value={displayValue}
            previewValue={isPreview ? displayValue : undefined}
            onChange={(newValue) => {
              const hasTag = newValue.includes('<') || newValue.includes('>')
              if (!isNumeric || newValue === '' || hasTag) {
                updateParameter(paramName, newValue)
                return
              }
              const parsed =
                numericType === 'integer'
                  ? Number.parseInt(newValue, 10)
                  : Number.parseFloat(newValue)
              updateParameter(paramName, Number.isNaN(parsed) ? '' : parsed)
            }}
            isPreview={isPreview}
            disabled={disabled}
            workflowSearchValuePath={[paramName]}
          />
        )
      }
    }
  }

  if (argumentsMode === 'json') {
    const jsonText = toDisplayText(isPreview ? previewValue : toolArgs)
    return (
      <div className={styles.param}>
        <span className={styles.label} data-type='T059'>
          JSON arguments
        </span>
        <LongInput
          blockId={blockId}
          subBlockId={subBlockId}
          config={{ id: subBlockId, ...JSON_ARGUMENTS_CONFIG }}
          placeholder={JSON_ARGUMENTS_CONFIG.placeholder}
          value={jsonText}
          previewValue={isPreview ? jsonText : undefined}
          onChange={(text) => {
            if (!disabled && !isPreview) setToolArgs(text)
          }}
          disabled={disabled}
          isPreview={isPreview}
        />
      </div>
    )
  }

  if (!selectedTool) {
    return (
      <p className={styles.note} data-type='T052'>
        Select a tool to configure its parameters
      </p>
    )
  }

  // Loading paints nothing; the fields appear once the schema settles.
  if (!cachedSchema && !selectedToolConfig && isLoading) return null

  if (!toolSchema) {
    return (
      <p className={styles.error} data-type='T052' role='alert'>
        Operation schema unavailable. Refresh or select an available operation.
      </p>
    )
  }

  const properties = schemaProperties(toolSchema)
  if (properties.length === 0) {
    return (
      <p className={styles.note} data-type='T052'>
        This tool requires no parameters
      </p>
    )
  }

  const required = schemaRequired(toolSchema)
  return (
    <div className={styles.params}>
      <AutofillDecoys />
      {properties.map(([paramName, paramSchema]) => (
        <div key={paramName} className={styles.param}>
          {getInputType(paramSchema) !== 'switch' && (
            <span className={styles.label} data-type='T059'>
              {formatParameterLabel(paramName)}
              {required.has(paramName) && <span aria-label='required'> *</span>}
            </span>
          )}
          {renderParameterInput(paramName, paramSchema)}
        </div>
      ))}
    </div>
  )
}
