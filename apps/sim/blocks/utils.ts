import { isHosted } from '@/lib/core/config/feature-flags'
import type { BlockOutput, OutputFieldDefinition, SubBlockConfig } from '@/blocks/types'
import { getHostedModels, getProviderFromModel, providers } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'

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
      requiredScopes: ['https://www.googleapis.com/auth/cloud-platform'],
      placeholder: 'Select Google Cloud account',
      required: true,
      condition: {
        field: 'model',
        value: providers.vertex.models,
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
      condition: {
        field: 'model',
        value: [...providers['azure-openai'].models, ...providers['azure-anthropic'].models],
      },
    },
    {
      id: 'azureApiVersion',
      title: 'Azure API Version',
      type: 'short-input',
      placeholder: 'Enter API version',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: [...providers['azure-openai'].models, ...providers['azure-anthropic'].models],
      },
    },
    {
      id: 'vertexProject',
      title: 'Vertex AI Project',
      type: 'short-input',
      placeholder: 'your-gcp-project-id',
      connectionDroppable: false,
      required: true,
      condition: {
        field: 'model',
        value: providers.vertex.models,
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
        value: providers.vertex.models,
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
      condition: {
        field: 'model',
        value: providers.bedrock.models,
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
      condition: {
        field: 'model',
        value: providers.bedrock.models,
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
        value: providers.bedrock.models,
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
