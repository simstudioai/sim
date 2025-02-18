import { TranslateIcon } from '@/components/icons'
import { ChatResponse } from '@/tools/openai/chat'
import { MODEL_TOOLS, ModelType } from '../consts'
import { BlockConfig } from '../types'

const getTranslationPrompt = (
  targetLanguage: string
) => `You are a highly skilled translator. Your task is to translate the given text into ${targetLanguage || 'English'} while:
1. Preserving the original meaning and nuance
2. Maintaining appropriate formality levels
3. Adapting idioms and cultural references appropriately
4. Preserving formatting and special characters
5. Handling technical terms accurately

Only return the translated text without any explanations or notes. The translation should be natural and fluent in ${targetLanguage || 'English'}.`

export const TranslateBlock: BlockConfig<ChatResponse> = {
  type: 'translate',
  name: 'Translate',
  description: 'Translate text to any language',
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
    },
    {
      id: 'targetLanguage',
      title: 'Translate To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter language (e.g. Spanish, French, etc.)',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: Object.keys(MODEL_TOOLS),
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
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

        const tool = MODEL_TOOLS[model as ModelType]

        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }

        return tool
      },
    },
  },
  inputs: {
    context: { type: 'string', required: true },
    targetLanguage: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    systemPrompt: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        model: 'string',
        tokens: 'any',
      },
    },
  },
}
