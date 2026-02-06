import { TranslateIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { getProviderCredentialSubBlocks, PROVIDER_CREDENTIAL_INPUTS } from '@/blocks/utils'
import { getProviderIcon } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'

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
    ...getProviderCredentialSubBlocks(),
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
        bedrockAccessKeyId: params.bedrockAccessKeyId,
        bedrockSecretKey: params.bedrockSecretKey,
        bedrockRegion: params.bedrockRegion,
      }),
    },
  },
  inputs: {
    context: { type: 'string', description: 'Text to translate' },
    targetLanguage: { type: 'string', description: 'Target language' },
    ...PROVIDER_CREDENTIAL_INPUTS,
    systemPrompt: { type: 'string', description: 'Translation instructions' },
  },
  outputs: {
    content: { type: 'string', description: 'Translated text' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'json', description: 'Token usage' },
  },
}
