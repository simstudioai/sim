import { isHosted } from '@/lib/core/config/feature-flags'
import type { BlockOutput, OutputFieldDefinition, SubBlockConfig } from '@/blocks/types'
import { getHostedModels, providers } from '@/providers/utils'
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

/**
 * Helper to get current vLLM models from store
 */
const getCurrentVLLMModels = () => {
  return useProvidersStore.getState().providers.vllm.models
}

/**
 * Get the API key condition for provider credential subblocks.
 * Handles hosted vs self-hosted environments and excludes providers that don't need API key.
 */
export function getApiKeyCondition() {
  return isHosted
    ? {
        field: 'model',
        value: [...getHostedModels(), ...providers.vertex.models, ...providers.bedrock.models],
        not: true,
      }
    : () => ({
        field: 'model',
        value: [
          ...getCurrentOllamaModels(),
          ...getCurrentVLLMModels(),
          ...providers.vertex.models,
          ...providers.bedrock.models,
        ],
        not: true,
      })
}

/**
 * Returns the standard provider credential subblocks used by LLM-based blocks.
 * This includes: Vertex AI OAuth, API Key, Azure OpenAI, Vertex AI config, and Bedrock config.
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
      title: 'Azure OpenAI Endpoint',
      type: 'short-input',
      password: true,
      placeholder: 'https://your-resource.openai.azure.com',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: providers['azure-openai'].models,
      },
    },
    {
      id: 'azureApiVersion',
      title: 'Azure API Version',
      type: 'short-input',
      placeholder: '2024-07-01-preview',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: providers['azure-openai'].models,
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
  azureEndpoint: { type: 'string', description: 'Azure OpenAI endpoint URL' },
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
