import { TranslateIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ProviderId } from '@/providers/types'
import { getBaseModelProviders } from '@/providers/utils'

const getTranslationPrompt = (
  targetLanguage: string
) => `You are a highly skilled translator. Your task is to translate the given text into ${targetLanguage || 'English'} while:
1. Preserving the original meaning and nuance
2. Maintaining appropriate formality levels
3. Adapting idioms and cultural references appropriately
4. Preserving formatting and special characters
5. Handling technical terms accurately

Only return the translated text without any explanations or notes. The translation should be natural and fluent in ${targetLanguage || 'English'}.`

export const TranslateBlock: BlockConfig = {
  type: 'translate',
  name: 'Translate',
  description: 'Translate text to any language',
  longDescription:
    'Convert text between languages while preserving meaning, nuance, and formatting. Utilize powerful language models to produce natural, fluent translations with appropriate cultural adaptations.',
  docsLink: 'https://docs.sim.ai/tools/translate',
  category: 'tools',
  bgColor: '#FF4B4B',
  icon: TranslateIcon,
  subBlocks: [
    {
      id: 'context',
      title: 'Text to Translate',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the text you want to translate',
      required: true,
    },
    {
      id: 'targetLanguage',
      title: 'Translate To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter language (e.g. Spanish, French, etc.)',
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: Object.keys(getBaseModelProviders()).map((key) => ({ label: key, id: key })),
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
      required: true,
    },
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'code',
      layout: 'full',
      hidden: true,
      value: (params: Record<string, any>) => {
        return getTranslationPrompt(params.targetLanguage || 'English')
      },
    },
  ],
  tools: {
    access: ['openai_chat', 'anthropic_chat', 'google_chat'],
    config: {
      tool: (params: Record<string, any>) => {
        const model = params.model || 'gpt-4o'

        if (!model) {
          throw new Error('No model selected')
        }

        const tool = getBaseModelProviders()[model as ProviderId]

        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }

        return tool
      },
    },
  },
  inputs: {
    context: { type: 'string', description: 'Text to translate' },
    targetLanguage: { type: 'string', description: 'Target language' },
    apiKey: { type: 'string', description: 'Provider API key' },
    systemPrompt: { type: 'string', description: 'Translation instructions' },
  },
  outputs: {
    content: { type: 'string', description: 'Translated text' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'any', description: 'Token usage' },
  },
}
