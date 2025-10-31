import { useCallback, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Info, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { InputWithTags } from '../input-with-tags'
import { TextareaWithTags } from '../textarea-with-tags'
import {
  coerceValue,
  inferInputType,
  isPasswordField,
  parseOpenApiSchema,
  type FieldConfig,
} from '@/lib/schemas/openapi-to-fields'
import { useReplicateCollections } from '@/hooks/use-replicate-collections'
import { useReplicateCollectionModels } from '@/hooks/use-replicate-collection-models'
import { useReplicateSchema } from '@/hooks/use-replicate-schema'
import { cn } from '@/lib/utils'

/**
 * OpenAPI Dynamic Inputs Component
 *
 * GENERIC COMPONENT: Renders dynamic form inputs based on OpenAPI/JSON Schema definitions.
 *
 * ⚠️ PRODUCTION STATUS: Tested with Replicate only
 *
 * This component is designed to work with any OpenAPI-based AI model provider by parsing
 * their schema definitions and generating appropriate UI inputs. However, it has currently
 * been tested and validated ONLY with Replicate's API.
 *
 * FEATURES:
 * - Dynamic input generation from OpenAPI/JSON Schema
 * - Support for multiple field types (string, number, boolean, enum, arrays)
 * - Optional field grouping (Required, Text, Numeric, Options, Toggles)
 * - Optional model selector with collection browsing
 * - Optional automatic schema fetching
 * - Type coercion for API compatibility
 * - Validation and error handling
 * - Environment variable resolution via tags ({{VAR_NAME}})
 *
 * USAGE WITH OTHER PROVIDERS:
 * When adapting this component for a new provider (HuggingFace, AWS Bedrock, etc.):
 *
 * 1. **Test Schema Compatibility**: Verify your provider's schema format works
 *    - Check field types map correctly (string, number, enum, boolean)
 *    - Test nested schemas and allOf/anyOf/oneOf handling
 *    - Validate default value initialization
 *
 * 2. **Disable Incompatible Features**: Not all providers have collections
 *    - Set modelSelector.enabled: false if no model browsing
 *    - Pass schema directly as prop instead of fetching
 *
 * 3. **Test Type Coercion**: Ensure values match your API's expectations
 *    - Strings ("5") should coerce to numbers (5) if type is integer
 *    - Booleans should coerce from strings if necessary
 *
 * 4. **Update This Documentation**: Add your provider to tested list
 *
 * CONFIGURATION:
 * - Model selector is OPTIONAL - disable via modelSelector.enabled: false
 * - Schema fetching is OPTIONAL - pass schema as prop for pre-loaded schemas
 * - Field grouping is OPTIONAL - disable via groupFields: false
 * - Field rendering is GENERIC - works with any valid JSON Schema
 *
 * EXAMPLE USAGE:
 *
 * // Replicate (with all features)
 * <OpenApiDynamicInputs
 *   blockId={blockId}
 *   subBlockId="modelInputs"
 *   modelSelector={{
 *     enabled: true,
 *     provider: 'replicate',
 *     enableCollections: true,
 *     collectionsEndpoint: '/api/replicate/collections',
 *     apiKeyHeaderName: 'x-replicate-api-key',
 *   }}
 *   schemaFetching={{
 *     enabled: true,
 *     endpoint: '/api/replicate/models',
 *     apiKeyHeaderName: 'x-replicate-api-key',
 *   }}
 *   groupFields={true}
 *   preferLongInput={true}
 * />
 *
 * // Future provider (schema-only, no model selector)
 * <OpenApiDynamicInputs
 *   blockId={blockId}
 *   subBlockId="params"
 *   schema={preloadedSchema}  // Pass schema directly
 *   modelSelector={{ enabled: false }}
 *   schemaFetching={{ enabled: false }}
 *   groupFields={false}
 * />
 *
 * TESTED PROVIDERS:
 * - ✅ Replicate (fully tested with 50+ models)
 * - ⏳ HuggingFace (pending)
 * - ⏳ AWS Bedrock (pending)
 *
 * @see https://github.com/simstudioai/sim/docs/add-replicate-block.md
 */

/**
 * Model selector configuration
 */
export interface ModelSelectorConfig {
  /** Enable model selector UI */
  enabled: boolean
  /** Provider type for endpoint configuration */
  provider: 'replicate' | 'huggingface' | 'custom'
  /** Enable collection browsing */
  enableCollections?: boolean
  /** Collections API endpoint */
  collectionsEndpoint?: string
  /** Collection models API endpoint */
  collectionModelsEndpoint?: string
  /** SubBlock ID for API key (default: 'apiKey') */
  apiKeySubBlockId?: string
  /** SubBlock ID for model value (default: 'model') */
  modelSubBlockId?: string
  /** SubBlock ID for collection value (default: 'collection') */
  collectionSubBlockId?: string
  /** Header name for API key authentication. Defaults to 'Authorization' with Bearer prefix if not specified. */
  apiKeyHeaderName?: string
}

/**
 * Schema fetching configuration
 */
export interface SchemaFetchingConfig {
  /** Enable automatic schema fetching */
  enabled: boolean
  /** Schema API endpoint */
  endpoint?: string
  /** SubBlock ID for API key (default: 'apiKey') */
  apiKeySubBlockId?: string
  /** SubBlock ID for version (default: 'version') */
  versionSubBlockId?: string
  /** SubBlock ID for model (default: 'model') */
  modelSubBlockId?: string
  /** Header name for API key authentication. Defaults to 'Authorization' with Bearer prefix if not specified. */
  apiKeyHeaderName?: string
}

/**
 * Props for the OpenApiDynamicInputs component
 */
export interface OpenApiDynamicInputsProps {
  // Core
  blockId: string
  subBlockId: string

  // Optional: Pre-provided schema (if not using schemaFetching)
  schema?: any | null
  model?: string | null
  apiKey?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void

  // NEW: Model selector integration
  modelSelector?: ModelSelectorConfig

  // NEW: Schema fetching integration
  schemaFetching?: SchemaFetchingConfig

  // UI Controls
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any
  isConnecting?: boolean

  // Customization
  groupFields?: boolean // Default: false (MCP), true (Replicate)
  preferLongInput?: boolean // Default: false (MCP), true (Replicate)
  showDescriptions?: boolean // Default: true
}

/**
 * Group of fields organized by type
 */
interface FieldGroup {
  name: string
  label: string
  fields: FieldConfig[]
  priority: number
}

/**
 * Shared OpenAPI Dynamic Inputs Component
 *
 * Renders dynamic form inputs based on OpenAPI/JSON Schema specifications.
 * Reusable across Replicate, MCP, and future OpenAPI-based blocks.
 *
 * **Key Features**:
 * - Uses existing SubBlock components (ShortInput, LongInput) - no custom tag handling!
 * - Supports field grouping (optional)
 * - Type coercion via shared utilities
 * - Validation with real-time feedback
 * - Loading/error states
 * - Preview mode support
 *
 * **Usage**:
 * ```typescript
 * <OpenApiDynamicInputs
 *   blockId={blockId}
 *   subBlockId="modelInputs"
 *   schema={schema}
 *   loading={loading}
 *   error={error}
 *   onRetry={retry}
 *   groupFields={true}        // Replicate-specific
 *   preferLongInput={true}    // Replicate-specific
 * />
 * ```
 */
export function OpenApiDynamicInputs({
  blockId,
  subBlockId,
  schema: propSchema,
  model: propModel,
  apiKey: propApiKey,
  loading: propLoading = false,
  error: propError = null,
  onRetry: propOnRetry,
  modelSelector,
  schemaFetching,
  disabled = false,
  isPreview = false,
  previewValue,
  isConnecting = false,
  groupFields = false,
  preferLongInput = false,
  showDescriptions = true,
}: OpenApiDynamicInputsProps) {
  // Get workspaceId from params (for env var resolution)
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Hooks (must be called before any returns)
  const [values, setValues] = useSubBlockValue(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  // Cross-subBlock reading for model selector (if enabled)
  const [apiKeyFromBlock, setApiKeyFromBlock] = useSubBlockValue(
    blockId,
    modelSelector?.apiKeySubBlockId || schemaFetching?.apiKeySubBlockId || 'apiKey'
  )
  const [modelFromBlock, setModelFromBlock] = useSubBlockValue(
    blockId,
    modelSelector?.modelSubBlockId || schemaFetching?.modelSubBlockId || 'model'
  )
  const [collectionFromBlock, setCollectionFromBlock] = useSubBlockValue(
    blockId,
    modelSelector?.collectionSubBlockId || 'collection'
  )
  const [versionFromBlock] = useSubBlockValue(
    blockId,
    schemaFetching?.versionSubBlockId || 'version'
  )

  // Determine which values to use (prop values or subBlock values)
  const apiKey = propApiKey || apiKeyFromBlock
  const model = propModel || modelFromBlock
  const collection = collectionFromBlock

  // Fetch collections (if model selector enabled with collections)
  const {
    collections,
    loading: collectionsLoading,
    error: collectionsError,
  } = useReplicateCollections({
    enabled: modelSelector?.enabled && modelSelector?.enableCollections && !!modelSelector?.collectionsEndpoint || false,
    apiKey,
    workspaceId,
    endpoint: modelSelector?.collectionsEndpoint || '',
    apiKeyHeaderName: modelSelector?.apiKeyHeaderName,
  })

  // Fetch collection models (if collection selected)
  const {
    models: collectionModels,
    loading: modelsLoading,
    error: modelsError,
  } = useReplicateCollectionModels({
    enabled: !!collection && collection !== 'none' && !!modelSelector?.collectionModelsEndpoint,
    collection,
    apiKey,
    workspaceId,
    endpoint: modelSelector?.collectionModelsEndpoint || '',
    apiKeyHeaderName: modelSelector?.apiKeyHeaderName,
  })

  // Fetch schema (if schemaFetching enabled)
  const {
    schema: fetchedSchema,
    loading: schemaLoading,
    error: schemaError,
    retry: schemaRetry,
  } = useReplicateSchema({
    model: schemaFetching?.enabled ? model : null,
    version: versionFromBlock as string | undefined,
    apiKey,
    workspaceId,
    endpoint: schemaFetching?.endpoint,
    apiKeyHeaderName: schemaFetching?.apiKeyHeaderName,
  })

  // Determine which schema/loading/error to use
  const schema = propSchema || (schemaFetching?.enabled ? fetchedSchema : null)
  const loading = propLoading || (schemaFetching?.enabled && schemaLoading)
  const error = propError || (schemaFetching?.enabled ? schemaError : null)
  const onRetry = propOnRetry || (schemaFetching?.enabled ? schemaRetry : undefined)

  // Get current values (handle preview mode and string JSON)
  const currentValues = useMemo(() => {
    if (isPreview && previewValue) {
      if (typeof previewValue === 'string') {
        try {
          return JSON.parse(previewValue)
        } catch {
          return previewValue
        }
      }
      return previewValue
    }

    if (typeof values === 'string') {
      try {
        return JSON.parse(values)
      } catch {
        return {}
      }
    }

    return values || {}
  }, [values, previewValue, isPreview])

  // Parse schema to field configs
  const fields = useMemo(() => {
    if (!schema) return []
    return parseOpenApiSchema(schema)
  }, [schema])

  // Initialize values with defaults when schema loads
  useEffect(() => {
    if (!schema || fields.length === 0 || isPreview) return

    // Check if we need to apply defaults
    const currentVals = currentValues
    const needsDefaults = fields.some(
      (field) => field.default !== undefined && currentVals[field.name] === undefined
    )

    if (!needsDefaults) return

    // Apply defaults to empty fields only
    const withDefaults = { ...currentVals }
    let hasChanges = false

    for (const field of fields) {
      // Only set default if field is currently undefined (don't overwrite user input)
      if (field.default !== undefined && withDefaults[field.name] === undefined) {
        withDefaults[field.name] = field.default
        hasChanges = true
      }
    }

    if (hasChanges) {
      setValues(withDefaults)
    }
  }, [schema, fields, currentValues, setValues, isPreview])

  // Group fields by type (if enabled)
  const groupedFields = useMemo((): Record<string, FieldGroup> => {
    if (!groupFields) {
      return {
        all: {
          name: 'all',
          label: 'All Fields',
          fields,
          priority: 0,
        },
      }
    }

    const groups: Record<string, FieldGroup> = {}

    // Group 1: Required fields
    const required = fields.filter((f) => f.required)
    if (required.length > 0) {
      groups.required = {
        name: 'required',
        label: 'Required',
        fields: required,
        priority: 1,
      }
    }

    // Group 2: Text inputs (strings, arrays, objects not in required)
    const textInputs = fields.filter(
      (f) =>
        !f.required &&
        (f.type === 'string' || f.type === 'array' || f.type === 'object') &&
        !f.enum
    )
    if (textInputs.length > 0) {
      groups.textInputs = {
        name: 'textInputs',
        label: 'Text Inputs',
        fields: textInputs,
        priority: 2,
      }
    }

    // Group 3: Options (enums) - Appears before numeric for better UX
    const options = fields.filter((f) => !f.required && f.enum)
    if (options.length > 0) {
      groups.options = {
        name: 'options',
        label: 'Options',
        fields: options,
        priority: 3,
      }
    }

    // Group 4: Numeric settings (numbers, integers)
    const numericSettings = fields.filter(
      (f) => !f.required && (f.type === 'integer' || f.type === 'number')
    )
    if (numericSettings.length > 0) {
      groups.numericSettings = {
        name: 'numericSettings',
        label: 'Numeric Settings',
        fields: numericSettings,
        priority: 4,
      }
    }

    // Group 5: Toggles (booleans)
    const toggles = fields.filter((f) => !f.required && f.type === 'boolean')
    if (toggles.length > 0) {
      groups.toggles = {
        name: 'toggles',
        label: 'Toggles',
        fields: toggles,
        priority: 5,
      }
    }

    return groups
  }, [fields, groupFields])

  // Update parameter (MCP object state pattern)
  const updateParameter = useCallback(
    (fieldName: string, value: any) => {
      if (disabled || isPreview) return

      const field = fields.find((f) => f.name === fieldName)
      if (!field) return

      // Coerce value to proper type
      const coerced = coerceValue(value, field)

      // Update entire object
      const updated = { ...currentValues, [fieldName]: coerced }
      setValues(updated)
    },
    [fields, currentValues, setValues, disabled, isPreview]
  )

  // Render individual field
  const renderField = useCallback(
    (field: FieldConfig) => {
      const value = currentValues[field.name]
      const inputType = inferInputType(field, { preferLongInput })
      const isPassword = isPasswordField(field.name, field)

      switch (inputType) {
        case 'switch':
          return (
            <div className='flex items-center space-x-3'>
              <Switch
                id={`${field.name}-switch`}
                checked={!!value}
                onCheckedChange={(checked) => updateParameter(field.name, checked)}
                disabled={disabled || isPreview}
              />
              <Label
                htmlFor={`${field.name}-switch`}
                className='cursor-pointer font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-1'
              >
                {field.title}
                {field.required && <span className='ml-1 text-red-500'>*</span>}
                {showDescriptions && field.description && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className='h-4 w-4 cursor-pointer text-muted-foreground' />
                    </TooltipTrigger>
                    <TooltipContent className='max-w-xs'>{field.description}</TooltipContent>
                  </Tooltip>
                )}
              </Label>
            </div>
          )

        case 'dropdown':
          return (
            <Select
              value={value?.toString() || field.default?.toString() || ''}
              onValueChange={(selectedValue) => updateParameter(field.name, selectedValue)}
              disabled={disabled || isPreview}
            >
              <SelectTrigger className='w-full'>
                <SelectValue placeholder="" />
              </SelectTrigger>
              <SelectContent>
                {field.enum?.map((option: any) => (
                  <SelectItem key={String(option)} value={String(option)}>
                    {String(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )

        case 'slider': {
          // Support negative ranges - no hardcoded defaults
          const minValue = field.minimum ?? 0
          const maxValue = field.maximum ?? 100
          const currentValue = value ?? field.default ?? minValue
          const isInteger = field.type === 'integer'

          // Read step from schema's multipleOf, with fallback to type-based defaults
          const step = field.multipleOf ?? (isInteger ? 1 : 0.1)

          // Normalize position for label (works correctly with negative ranges)
          const range = maxValue - minValue
          const normalizedPosition = range > 0 ? ((currentValue - minValue) / range) * 100 : 50
          // Clamp position to prevent label overflow at edges (5% to 95%)
          const clampedPosition = Math.max(5, Math.min(95, normalizedPosition))

          return (
            <div className='relative pt-2 pb-6'>
              <Slider
                value={[currentValue]}
                min={minValue}
                max={maxValue}
                step={step}
                onValueChange={(newValue) =>
                  updateParameter(field.name, isInteger ? Math.round(newValue[0]) : newValue[0])
                }
                disabled={disabled || isPreview}
                className='[&_[class*=SliderTrack]]:h-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4'
              />
              <div
                className='absolute text-muted-foreground text-sm'
                style={{
                  left: `${clampedPosition}%`,
                  transform: 'translateX(-50%)',
                  top: '24px',
                }}
              >
                {isInteger ? Math.round(currentValue).toString() : Number(currentValue).toFixed(1)}
              </div>
            </div>
          )
        }

        case 'long-input':
          // Use shared TextareaWithTags component
          return (
            <TextareaWithTags
              blockId={blockId}
              value={value?.toString() || ''}
              onChange={(newValue) => updateParameter(field.name, newValue)}
              placeholder={field.description || `Enter ${field.title.toLowerCase()}`}
              disabled={disabled || isPreview}
              accessiblePrefixes={accessiblePrefixes}
              rows={4}
              isConnecting={isConnecting}
            />
          )

        case 'short-input':
        default:
          // Use shared InputWithTags component
          return (
            <InputWithTags
              blockId={blockId}
              value={value?.toString() || ''}
              onChange={(newValue) => updateParameter(field.name, newValue)}
              placeholder={field.description || `Enter ${field.title.toLowerCase()}`}
              isPassword={isPassword}
              disabled={disabled || isPreview}
              accessiblePrefixes={accessiblePrefixes}
              isConnecting={isConnecting}
            />
          )
      }
    },
    [
      blockId,
      subBlockId,
      currentValues,
      updateParameter,
      disabled,
      isPreview,
      isConnecting,
      preferLongInput,
      accessiblePrefixes,
    ]
  )

  // Render field with label (except for switch which has inline label)
  const renderFieldWithLabel = useCallback(
    (field: FieldConfig) => {
      const inputType = inferInputType(field, { preferLongInput })
      const showLabel = inputType !== 'switch'

      return (
        <div key={field.name} className='space-y-2'>
          {showLabel && (
            <Label className='flex items-center gap-1'>
              {field.title}
              {field.required && <span className='text-red-500'>*</span>}
              {showDescriptions && field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className='h-4 w-4 cursor-pointer text-muted-foreground' />
                  </TooltipTrigger>
                  <TooltipContent className='max-w-xs'>{field.description}</TooltipContent>
                </Tooltip>
              )}
            </Label>
          )}
          {renderField(field)}
        </div>
      )
    },
    [renderField, showDescriptions, preferLongInput]
  )

  // Debug logging in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[OpenApiDynamicInputs Debug]', {
        blockId,
        subBlockId,
        modelSelector: modelSelector?.enabled ? 'enabled' : 'disabled',
        schemaFetching: schemaFetching?.enabled ? 'enabled' : 'disabled',
        model,
        collection,
        apiKey: apiKey ? '***SET***' : null,
        schema: schema ? 'loaded' : null,
        fields: fields.length,
        collectionsCount: collections.length,
        modelsCount: collectionModels.length,
      })
    }
  }, [blockId, subBlockId, model, collection, apiKey, schema, fields, collections, collectionModels, modelSelector, schemaFetching])

  // Validate configuration in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && modelSelector?.enabled) {
      const issues: string[] = []

      if (!modelSelector.provider) {
        issues.push('modelSelector.provider is required')
      }
      if (modelSelector.enableCollections && !modelSelector.collectionsEndpoint) {
        issues.push('modelSelector.collectionsEndpoint required when enableCollections is true')
      }

      if (issues.length > 0) {
        console.error('[OpenApiDynamicInputs] Configuration issues:', issues)
      }
    }
  }, [modelSelector])

  // RESTRUCTURED RENDERING: Model selector first, then state-dependent inputs
  return (
    <div className='space-y-6'>
      {/* SECTION 1: Model Selector (always render if enabled) */}
      {modelSelector?.enabled && (
        <div className='space-y-4'>
          {/* Collection Dropdown */}
          {modelSelector.enableCollections && (
            <div className='space-y-2'>
              <Label className='font-medium text-sm'>Collection</Label>
              <Select
                value={collection || 'none'}
                onValueChange={(value) => setCollectionFromBlock(value)}
                disabled={disabled || isPreview || collectionsLoading}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder={collectionsLoading ? 'Loading collections...' : 'Select collection'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>None (enter model directly)</SelectItem>
                  {collections.map((col) => (
                    <SelectItem key={col.value} value={col.value}>
                      {col.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {collectionsError && (
                <p className='text-destructive text-xs'>{collectionsError}</p>
              )}
            </div>
          )}

          {/* Model Input/Dropdown */}
          <div className='space-y-2'>
            <Label className='font-medium text-sm'>
              Model
              <span className='ml-1 text-red-500'>*</span>
            </Label>
            {collection && collection !== 'none' ? (
              // Collection mode: dropdown of models
              <Select
                value={model || ''}
                onValueChange={(value) => setModelFromBlock(value)}
                disabled={disabled || isPreview || modelsLoading}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder={modelsLoading ? 'Loading models...' : 'Select model'} />
                </SelectTrigger>
                <SelectContent>
                  {collectionModels.map((modelOption) => (
                    <SelectItem key={modelOption.value} value={modelOption.value}>
                      {modelOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              // Direct entry mode: text input
              <Input
                value={model || ''}
                onChange={(e) => setModelFromBlock(e.target.value)}
                placeholder='owner/model-name'
                disabled={disabled || isPreview}
              />
            )}
            {modelsError && (
              <p className='text-destructive text-xs'>{modelsError}</p>
            )}
          </div>
        </div>
      )}

      {/* SECTION 2: Dynamic Inputs (state-dependent rendering) */}
      {!model || (typeof model === 'string' && model.trim() === '') ? (
        <div className='rounded-lg border border-dashed p-8 text-center'>
          <Info className='mx-auto mb-2 h-8 w-8 text-muted-foreground/60' />
          <p className='font-medium text-muted-foreground text-sm'>
            {modelSelector?.enabled
              ? 'Select a model from the dropdown above'
              : 'Enter a model name above to load parameters'}
          </p>
          {modelSelector?.enableCollections && (
            <p className='mt-1 text-muted-foreground/80 text-xs'>
              Browse by collection or enter directly in owner/model-name format
            </p>
          )}
        </div>
      ) : !apiKey || (typeof apiKey === 'string' && apiKey.trim() === '') ? (
        <div className='rounded-lg border border-dashed p-8 text-center'>
          <p className='text-muted-foreground text-sm'>API Token required</p>
        </div>
      ) : loading ? (
        <div className='rounded-lg border border-dashed p-8 text-center'>
          <RotateCw className='mx-auto mb-2 h-4 w-4 animate-spin text-muted-foreground' />
          <p className='text-muted-foreground text-sm'>Loading model schema...</p>
        </div>
      ) : error ? (
        <div className='rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center'>
          <p className='text-destructive text-sm font-medium'>Failed to load schema</p>
          <p className='text-muted-foreground text-xs mt-2'>{error}</p>
          {onRetry && (
            <Button variant='outline' size='sm' onClick={onRetry} className='mt-4'>
              <RotateCw className='mr-2 h-3 w-3' />
              Retry
            </Button>
          )}
        </div>
      ) : fields.length === 0 ? (
        <div className='rounded-lg border border-dashed p-8 text-center'>
          <p className='text-muted-foreground text-sm'>No input parameters required for this model</p>
        </div>
      ) : (
        /* Render dynamic fields */
        <>
          {Object.entries(groupedFields)
            .sort(([, a], [, b]) => a.priority - b.priority)
            .map(([groupName, group]) => {
              if (group.fields.length === 0) return null

              // Use grid layout for numeric fields (sliders/numbers look better side-by-side)
              const isNumericGroup = groupName === 'numericSettings'
              const useGrid = isNumericGroup && group.fields.length >= 2

              return (
                <div
                  key={groupName}
                  className={cn(useGrid ? 'grid grid-cols-2 gap-4' : 'space-y-4')}
                >
                  {group.fields.map(renderFieldWithLabel)}
                </div>
              )
            })}
        </>
      )}
    </div>
  )
}
