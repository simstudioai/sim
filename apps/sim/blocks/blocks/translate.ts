import { TranslateIcon } from '@/components/icons'
import { isHosted } from '@/lib/core/config/feature-flags'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { getHostedModels, getProviderIcon, providers } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'

const getCurrentOllamaModels = () => {
  return useProvidersStore.getState().providers.ollama.models
}

const getCurrentVLLMModels = () => {
  return useProvidersStore.getState().providers.vllm.models
}

const getTranslationPrompt = (targetLanguage: string) =>
  `Translate the following text into ${targetLanguage || 'English'}. Output ONLY the translated text with no additional commentary, explanations, or notes.`

export const TranslateBlock: BlockConfig = {
  type: 'translate',
  name: 'Translate',
  description: 'Translate text to any language',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Translate into the workflow. Can translate text to any language.',
  docsLink: 'https://docs.sim.ai/tools/translate',
  category: 'tools',
  bgColor: '#FF4B4B',
  icon: TranslateIcon,
  subBlocks: [
    {
      id: 'context',
      title: 'Text to Translate',
      type: 'long-input',
      placeholder: 'Enter the text you want to translate',
      required: true,
    },
    {
      id: 'targetLanguage',
      title: 'Translate To',
      type: 'short-input',
      placeholder: 'Enter language (e.g. Spanish, French, etc.)',
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
      required: true,
      options: () => {
        const providersState = useProvidersStore.getState()
        const baseModels = providersState.providers.base.models
        const ollamaModels = providersState.providers.ollama.models
        const openrouterModels = providersState.providers.openrouter.models
        const allModels = Array.from(new Set([...baseModels, ...ollamaModels, ...openrouterModels]))

        return allModels.map((model) => {
          const icon = getProviderIcon(model)
          return { label: model, id: model, ...(icon && { icon }) }
        })
      },
    },
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
      // Hide API key for hosted models, Ollama models, vLLM models, and Vertex models (uses OAuth)
      condition: isHosted
        ? {
            field: 'model',
            value: [...getHostedModels(), ...providers.vertex.models],
            not: true, // Show for all models EXCEPT those listed
          }
        : () => ({
            field: 'model',
            value: [
              ...getCurrentOllamaModels(),
              ...getCurrentVLLMModels(),
              ...providers.vertex.models,
            ],
            not: true, // Show for all models EXCEPT Ollama, vLLM, and Vertex models
          }),
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
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'code',
      hidden: true,
      value: (params: Record<string, any>) => {
        return getTranslationPrompt(params.targetLanguage || 'English')
      },
    },
  ],
  tools: {
    access: ['llm_chat'],
    config: {
      tool: () => 'llm_chat',
      params: (params: Record<string, any>) => ({
        model: params.model,
        systemPrompt: getTranslationPrompt(params.targetLanguage || 'English'),
        context: params.context,
        apiKey: params.apiKey,
        azureEndpoint: params.azureEndpoint,
        azureApiVersion: params.azureApiVersion,
        vertexProject: params.vertexProject,
        vertexLocation: params.vertexLocation,
        vertexCredential: params.vertexCredential,
      }),
    },
  },
  inputs: {
    context: { type: 'string', description: 'Text to translate' },
    targetLanguage: { type: 'string', description: 'Target language' },
    apiKey: { type: 'string', description: 'Provider API key' },
    azureEndpoint: { type: 'string', description: 'Azure OpenAI endpoint URL' },
    azureApiVersion: { type: 'string', description: 'Azure API version' },
    vertexProject: { type: 'string', description: 'Google Cloud project ID for Vertex AI' },
    vertexLocation: { type: 'string', description: 'Google Cloud location for Vertex AI' },
    vertexCredential: {
      type: 'string',
      description: 'Google Cloud OAuth credential ID for Vertex AI',
    },
    systemPrompt: { type: 'string', description: 'Translation instructions' },
  },
  outputs: {
    content: { type: 'string', description: 'Translated text' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'json', description: 'Token usage' },
  },
}
