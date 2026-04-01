import { isAzureConfigured, isHosted } from '@/lib/core/config/feature-flags'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockOutput, OutputFieldDefinition, SubBlockConfig } from '@/blocks/types'
import {
  getHostedModels,
  getProviderFromModel,
  getProviderIcon,
  getProviderModels,
} from '@/providers/models'
import { useProvidersStore } from '@/stores/providers/store'

export const VERTEX_MODELS = getProviderModels('vertex')
export const BEDROCK_MODELS = getProviderModels('bedrock')
export const AZURE_MODELS = [
  ...getProviderModels('azure-openai'),
  ...getProviderModels('azure-anthropic'),
]

/**
 * Returns model options for combobox subblocks, combining all provider sources.
 */
export function getModelOptions() {
  const providersState = useProvidersStore.getState()
  const baseModels = providersState.providers.base.models
  const ollamaModels = providersState.providers.ollama.models
  const vllmModels = providersState.providers.vllm.models
  const openrouterModels = providersState.providers.openrouter.models
  const fireworksModels = providersState.providers.fireworks.models
  const allModels = Array.from(
    new Set([
      ...baseModels,
      ...ollamaModels,
      ...vllmModels,
      ...openrouterModels,
      ...fireworksModels,
    ])
  )

  return allModels.map((model) => {
    const icon = getProviderIcon(model)
    return { label: model, id: model, ...(icon && { icon }) }
  })
}

/**
 * Checks if a field is included in the dependsOn config.
 * Handles both simple array format and object format with all/any fields.
 */
export function isDependency(dependsOn: SubBlockConfig['dependsOn'], field: string): boolean {
  if (!dependsOn) return false
  if (Array.isArray(dependsOn)) return dependsOn.includes(field)
  return dependsOn.all?.includes(field) || dependsOn.any?.includes(field) || false
}

/**
 * Gets all dependency fields as a flat array.
 * Handles both simple array format and object format with all/any fields.
 */
export function getDependsOnFields(dependsOn: SubBlockConfig['dependsOn']): string[] {
  if (!dependsOn) return []
  if (Array.isArray(dependsOn)) return dependsOn
  return [...(dependsOn.all || []), ...(dependsOn.any || [])]
}

export function resolveOutputType(
  outputs: Record<string, OutputFieldDefinition>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputType] of Object.entries(outputs)) {
    // Handle new format: { type: 'string', description: '...' }
    if (typeof outputType === 'object' && outputType !== null && 'type' in outputType) {
      resolvedOutputs[key] = outputType.type as BlockOutput
    } else {
      // Handle old format: just the type as string, or other object formats
      resolvedOutputs[key] = outputType as BlockOutput
    }
  }

  return resolvedOutputs
}

/**
 * Helper to get current Ollama models from store
 */
const getCurrentOllamaModels = () => {
  return useProvidersStore.getState().providers.ollama.models
}

function buildModelVisibilityCondition(model: string, shouldShow: boolean) {
  if (!model) {
    return { field: 'model', value: '__no_model_selected__' }
  }

  return shouldShow ? { field: 'model', value: model } : { field: 'model', value: model, not: true }
}

function shouldRequireApiKeyForModel(model: string): boolean {
  const normalizedModel = model.trim().toLowerCase()
  if (!normalizedModel) return false

  const hostedModels = getHostedModels()
  const isHostedModel = hostedModels.some(
    (hostedModel) => hostedModel.toLowerCase() === normalizedModel
  )
  if (isHosted && isHostedModel) return false

  if (normalizedModel.startsWith('vertex/') || normalizedModel.startsWith('bedrock/')) {
    return false
  }

  if (
    isAzureConfigured &&
    (normalizedModel.startsWith('azure/') ||
      normalizedModel.startsWith('azure-openai/') ||
      normalizedModel.startsWith('azure-anthropic/') ||
      AZURE_MODELS.some((m) => m.toLowerCase() === normalizedModel))
  ) {
    return false
  }

  if (normalizedModel.startsWith('vllm/')) {
    return false
  }

  const currentOllamaModels = getCurrentOllamaModels()
  if (currentOllamaModels.some((ollamaModel) => ollamaModel.toLowerCase() === normalizedModel)) {
    return false
  }

  if (!isHosted) {
    try {
      const providerId = getProviderFromModel(model)
      if (
        providerId === 'ollama' ||
        providerId === 'vllm' ||
        providerId === 'vertex' ||
        providerId === 'bedrock'
      ) {
        return false
      }
    } catch {
      // If model resolution fails, fall through and require an API key.
    }
  }

  return true
}

/**
 * Get the API key condition for provider credential subblocks.
 * Handles hosted vs self-hosted environments and excludes providers that don't need API key.
 */
export function getApiKeyCondition() {
  return (values?: Record<string, unknown>) => {
    const model = typeof values?.model === 'string' ? values.model : ''
    const shouldShow = shouldRequireApiKeyForModel(model)
    return buildModelVisibilityCondition(model, shouldShow)
  }
}

/**
 * Returns the standard provider credential subblocks used by LLM-based blocks.
 * This includes: Vertex AI OAuth, API Key, Azure (OpenAI + Anthropic), Vertex AI config, and Bedrock config.
 *
 * Usage: Spread into your block's subBlocks array after block-specific fields
 */
export function getProviderCredentialSubBlocks(): SubBlockConfig[] {
  return [
    {
      id: 'vertexCredential',
      title: 'Google Cloud Account',
      type: 'oauth-input',
      serviceId: 'vertex-ai',
      canonicalParamId: 'vertexCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('vertex-ai'),
      placeholder: 'Select Google Cloud account',
      required: true,
      condition: {
        field: 'model',
        value: VERTEX_MODELS,
      },
    },
    {
      id: 'vertexManualCredential',
      title: 'Google Cloud Account',
      type: 'short-input',
      canonicalParamId: 'vertexCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
      condition: {
        field: 'model',
        value: VERTEX_MODELS,
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
      required: true,
      condition: getApiKeyCondition(),
    },
    {
      id: 'azureEndpoint',
      title: 'Azure Endpoint',
      type: 'short-input',
      password: true,
      placeholder: 'https://your-resource.services.ai.azure.com',
      connectionDroppable: false,
      hideWhenEnvSet: 'NEXT_PUBLIC_AZURE_CONFIGURED',
      condition: {
        field: 'model',
        value: AZURE_MODELS,
      },
    },
    {
      id: 'azureApiVersion',
      title: 'Azure API Version',
      type: 'short-input',
      placeholder: 'Enter API version',
      connectionDroppable: false,
      hideWhenEnvSet: 'NEXT_PUBLIC_AZURE_CONFIGURED',
      condition: {
        field: 'model',
        value: AZURE_MODELS,
      },
    },
    {
      id: 'vertexProject',
      title: 'Vertex AI Project',
      type: 'short-input',
      password: true,
      placeholder: 'your-gcp-project-id',
      connectionDroppable: false,
      required: true,
      condition: {
        field: 'model',
        value: VERTEX_MODELS,
      },
    },
    {
      id: 'vertexLocation',
      title: 'Vertex AI Location',
      type: 'short-input',
      placeholder: 'us-central1',
      connectionDroppable: false,
      required: true,
      condition: {
        field: 'model',
        value: VERTEX_MODELS,
      },
    },
    {
      id: 'bedrockAccessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your AWS Access Key ID',
      connectionDroppable: false,
      required: true,
      hideWhenEnvSet: 'NEXT_PUBLIC_BEDROCK_DEFAULT_CREDENTIALS',
      condition: {
        field: 'model',
        value: BEDROCK_MODELS,
      },
    },
    {
      id: 'bedrockSecretKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your AWS Secret Access Key',
      connectionDroppable: false,
      required: true,
      hideWhenEnvSet: 'NEXT_PUBLIC_BEDROCK_DEFAULT_CREDENTIALS',
      condition: {
        field: 'model',
        value: BEDROCK_MODELS,
      },
    },
    {
      id: 'bedrockRegion',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: BEDROCK_MODELS,
      },
    },
  ]
}

/**
 * Returns the standard input definitions for provider credentials.
 * Use this in your block's inputs definition.
 */
export const PROVIDER_CREDENTIAL_INPUTS = {
  apiKey: { type: 'string', description: 'Provider API key' },
  azureEndpoint: { type: 'string', description: 'Azure endpoint URL' },
  azureApiVersion: { type: 'string', description: 'Azure API version' },
  vertexProject: { type: 'string', description: 'Google Cloud project ID for Vertex AI' },
  vertexLocation: { type: 'string', description: 'Google Cloud location for Vertex AI' },
  vertexCredential: {
    type: 'string',
    description: 'Google Cloud OAuth credential ID for Vertex AI',
  },
  bedrockAccessKeyId: { type: 'string', description: 'AWS Access Key ID for Bedrock' },
  bedrockSecretKey: { type: 'string', description: 'AWS Secret Access Key for Bedrock' },
  bedrockRegion: { type: 'string', description: 'AWS region for Bedrock' },
} as const

/**
 * Create a versioned tool selector from an existing tool selector.
 *
 * This is useful for `*_v2` blocks where the operation UI remains the same, but
 * the underlying tool IDs are suffixed (e.g. `cursor_launch_agent` -> `cursor_launch_agent_v2`).
 *
 * @example
 * tools: {
 *   config: {
 *     tool: createVersionedToolSelector({
 *       baseToolSelector: (params) => params.operation,
 *       suffix: '_v2',
 *       fallbackToolId: 'cursor_launch_agent_v2',
 *     }),
 *   },
 * }
 */
export function createVersionedToolSelector<TParams extends Record<string, any>>(args: {
  baseToolSelector: (params: TParams) => string
  suffix: `_${string}`
  fallbackToolId: string
}): (params: TParams) => string {
  const { baseToolSelector, suffix, fallbackToolId } = args

  return (params: TParams) => {
    try {
      const baseToolId = baseToolSelector(params)
      if (!baseToolId || typeof baseToolId !== 'string') return fallbackToolId
      return baseToolId.endsWith(suffix) ? baseToolId : `${baseToolId}${suffix}`
    } catch {
      return fallbackToolId
    }
  }
}

const DEFAULT_MULTIPLE_FILES_ERROR =
  'File reference must be a single file, not an array. Use <block.files[0]> to select one file.'

/**
 * Normalizes file input from block params to a consistent format.
 * Handles the case where template resolution JSON.stringify's arrays/objects
 * when they're placed in short-input fields (advanced mode).
 *
 * @param fileParam - The file parameter which could be:
 *   - undefined/null (no files)
 *   - An array of file objects (basic mode or properly resolved)
 *   - A single file object
 *   - A JSON string of file(s) (from advanced mode template resolution)
 * @param options.single - If true, returns single file object and throws if multiple provided
 * @param options.errorMessage - Custom error message when single is true and multiple files provided
 * @returns Normalized file(s), or undefined if no files
 */
export function normalizeFileInput(
  fileParam: unknown,
  options: { single: true; errorMessage?: string }
): object | undefined
export function normalizeFileInput(
  fileParam: unknown,
  options?: { single?: false }
): object[] | undefined
export function normalizeFileInput(
  fileParam: unknown,
  options?: { single?: boolean; errorMessage?: string }
): object | object[] | undefined {
  if (!fileParam) return undefined

  if (typeof fileParam === 'string') {
    try {
      fileParam = JSON.parse(fileParam)
    } catch {
      return undefined
    }
  }

  let files: object[] | undefined

  if (Array.isArray(fileParam)) {
    files = fileParam.length > 0 ? fileParam : undefined
  } else if (typeof fileParam === 'object' && fileParam !== null) {
    files = [fileParam]
  }

  if (!files) return undefined

  if (options?.single) {
    if (files.length > 1) {
      throw new Error(options.errorMessage ?? DEFAULT_MULTIPLE_FILES_ERROR)
    }
    return files[0]
  }

  return files
}

/**
 * Block types that are built-in to the platform (as opposed to third-party integrations).
 * Used to categorize tools in the tool selection dropdown.
 */
export const BUILT_IN_TOOL_TYPES = new Set([
  'api',
  'file',
  'function',
  'knowledge',
  'search',
  'thinking',
  'image_generator',
  'video_generator',
  'vision',
  'translate',
  'tts',
  'stt',
  'memory',
  'table',
  'webhook_request',
  'workflow',
])

/**
 * Shared wand configuration for the Response Format code subblock.
 * Used by Agent and Mothership blocks.
 */
export const RESPONSE_FORMAT_WAND_CONFIG = {
  enabled: true,
  maintainHistory: true,
  prompt: `You are an expert programmer specializing in creating JSON schemas according to a specific format.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
    "name": "reddit_post",
    "description": "Fetches the reddit posts in the given subreddit",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title of the post"
            },
            "content": {
                "type": "string",
                "description": "The content of the post"
            }
        },
        "additionalProperties": false,
        "required": [ "title", "content" ]
    }
}

Example 2:
{
    "name": "get_weather",
    "description": "Fetches the current weather for a specific location.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "The city and state, e.g., San Francisco, CA"
            },
            "unit": {
                "type": "string",
                "description": "Temperature unit",
                "enum": ["celsius", "fahrenheit"]
            }
        },
        "additionalProperties": false,
        "required": ["location", "unit"]
    }
}

Example 3 (Array Input):
{
    "name": "process_items",
    "description": "Processes a list of items with specific IDs.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "item_ids": {
                "type": "array",
                "description": "A list of unique item identifiers to process.",
                "items": {
                    "type": "string",
                    "description": "An item ID"
                }
            },
            "processing_mode": {
                "type": "string",
                "description": "The mode for processing",
                "enum": ["fast", "thorough"]
            }
        },
        "additionalProperties": false,
        "required": ["item_ids", "processing_mode"]
    }
}
`,
  placeholder: 'Describe the JSON schema structure you need...',
  generationType: 'json-schema' as const,
}
