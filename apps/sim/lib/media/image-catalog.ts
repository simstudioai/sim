import falModels from '@/lib/media/fal-image-models.json'

export const imageOptionFields = [
  'size',
  'aspectRatio',
  'resolution',
  'quality',
  'background',
  'outputFormat',
  'moderation',
  'safetyTolerance',
  'thinkingLevel',
] as const

type ImageOption = (typeof imageOptionFields)[number]
interface ImageModel {
  provider: 'openai' | 'gemini' | 'falai'
  id: string
  label: string
  endpoint?: string
  output?: string
  options?: Partial<Record<ImageOption, { field: string; values: readonly (string | number)[] }>>
  booleans?: Readonly<Record<string, string>>
  seed?: boolean
  requestDefaults?: Readonly<Record<string, string | number | boolean>>
  minPromptLength?: number
  maxPromptLength?: number
}

export const imageModelDefaults = {
  openai: 'gpt-image-1.5',
  gemini: 'gemini-3.1-flash-image',
  falai: 'nano-banana-2',
} as const

const sizes = ['auto', '1024x1024', '1536x1024', '1024x1536']
const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const extremeRatios = [...ratios, '1:4', '4:1', '1:8', '8:1']
const formats = ['png', 'jpeg', 'webp']
const openaiModels = [
  ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'],
  ['gpt-image-2.5-flare', 'GPT Image 2.5 Flare'],
  ['gpt-image-2', 'GPT Image 2'],
  ['gpt-image-1.5', 'GPT Image 1.5'],
  ['gpt-image-1-mini', 'GPT Image 1 Mini'],
  ['chatgpt-image-latest', 'ChatGPT Image Latest'],
  ['gpt-image-2.5-sunburst-2026-09-08', 'GPT Image 2.5 Sunburst (2026-09-08)'],
  ['gpt-image-2.5-flare-2026-09-08', 'GPT Image 2.5 Flare (2026-09-08)'],
  ['gpt-image-2-2026-04-21', 'GPT Image 2 (2026-04-21)'],
] as const
const geminiModels = [
  ['gemini-nano-banana-2.1', 'Nano Banana 2.1'],
  ['gemini-3-pro-image', 'Nano Banana Pro'],
  ['gemini-3.1-flash-image', 'Nano Banana 2'],
  ['gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite'],
  ['gemini-2.5-flash-image', 'Nano Banana'],
] as const

/** Current prompt-to-image models, shared by the block and provider request validation. */
export const imageModels: readonly ImageModel[] = [
  ...openaiModels.map(
    ([id, label]): ImageModel => ({
      provider: 'openai',
      id,
      label,
      options: {
        size: {
          field: 'size',
          values: id.startsWith('gpt-image-2') ? [...sizes, '2560x1440', '3840x2160'] : sizes,
        },
        quality: {
          field: 'quality',
          values: [
            'auto',
            'low',
            'medium',
            'high',
            ...(id.startsWith('gpt-image-2.5') ? ['xhigh', 'max'] : []),
          ],
        },
        background: { field: 'background', values: ['auto', 'transparent', 'opaque'] },
        outputFormat: { field: 'output_format', values: formats },
        moderation: { field: 'moderation', values: ['auto', 'low'] },
      },
      requestDefaults: { n: 1, size: 'auto' },
    })
  ),
  ...geminiModels.map(
    ([id, label]): ImageModel => ({
      provider: 'gemini',
      id,
      label,
      options: {
        aspectRatio: {
          field: 'aspectRatio',
          values:
            id === 'gemini-nano-banana-2.1' || id === 'gemini-3.1-flash-image'
              ? extremeRatios
              : ratios,
        },
        ...(!['gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image'].includes(id) && {
          resolution: {
            field: 'imageSize',
            values: [...(id === 'gemini-3.1-flash-image' ? ['512'] : []), '1K', '2K', '4K'],
          },
        }),
      },
    })
  ),
  ...Object.entries(falModels).map(
    ([endpoint, spec]): ImageModel => ({
      ...spec,
      provider: 'falai',
      endpoint,
      id: 'legacyId' in spec ? spec.legacyId : endpoint,
    })
  ),
]

const byId = new Map(imageModels.map((model) => [`${model.provider}:${model.id}`, model]))
for (const model of imageModels) {
  if (model.endpoint) byId.set(`falai:${model.endpoint}`, model)
}
const geminiAliases: Record<string, string> = {
  'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image',
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
}

export function getImageModel(provider: unknown, id: unknown) {
  if (typeof provider !== 'string' || typeof id !== 'string') return undefined
  const modelId = provider === 'gemini' ? (geminiAliases[id] ?? id) : id
  return byId.get(`${provider}:${modelId}`)
}
