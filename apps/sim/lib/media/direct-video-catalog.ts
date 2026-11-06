import runwayModels from '@/lib/media/runway-video-models.json'

interface VideoSettings {
  durations?: readonly number[]
  aspectRatios?: readonly string[]
  resolutions?: readonly string[]
  audio?: boolean
  promptOptimizer?: boolean
  maxPromptLength?: number
  defaults?: Readonly<Record<string, string | number>>
}
interface DirectVideoModel {
  provider: 'runway' | 'veo' | 'luma' | 'minimax' | 'higgsfield'
  id: string
  label: string
  aliases?: readonly string[]
  protocol:
    | 'runway'
    | 'gemini'
    | 'luma'
    | 'luma-legacy'
    | 'minimax-v1'
    | 'minimax-v2'
    | 'higgsfield'
  /** Request field that carries the audio toggle, for models whose field differs by family. */
  audioField?: 'sound' | 'generate_audio'
  text?: VideoSettings
  image?: VideoSettings
}

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)
const ratios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

/** Provider-native generation models; settings follow each provider's published API schema. */
export const directVideoModels: readonly DirectVideoModel[] = [
  ...Object.entries(runwayModels).map(
    ([id, spec]): DirectVideoModel => ({
      ...spec,
      provider: 'runway',
      protocol: 'runway',
      id,
      aliases: id === 'gen4_turbo' ? ['gen-4', 'gen-4-turbo'] : [],
    })
  ),
  {
    provider: 'veo',
    id: 'gemini-omni-1.1-flash',
    label: 'Gemini Omni 1.1 Flash',
    protocol: 'gemini',
    text: { aspectRatios: ['16:9', '9:16'], resolutions: ['360p', '720p', '1080p', '4k'] },
  },
  {
    provider: 'luma',
    id: 'ray-3.2',
    label: 'Ray 3.2',
    protocol: 'luma',
    text: {
      maxPromptLength: 6000,
      durations: [5, 10],
      aspectRatios: ratios,
      resolutions: ['360p', '540p', '720p', '1080p'],
      defaults: { duration: 5, resolution: '720p', aspect_ratio: '16:9' },
    },
  },
  ...['ray-2', 'ray-flash-2'].map(
    (id): DirectVideoModel => ({
      provider: 'luma',
      id,
      label: id === 'ray-2' ? 'Ray 2 (legacy)' : 'Ray 2 Flash (legacy)',
      protocol: 'luma-legacy',
      text: {
        durations: [5, 9],
        aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21'],
        resolutions: ['540p', '720p', '1080p', '4k'],
        defaults: { duration: 5, resolution: '1080p', aspect_ratio: '16:9' },
      },
    })
  ),
  ...['MiniMax-H3', 'MiniMax-H3-Highspeed', 'MiniMax-H3-Lite', 'MiniMax-H3-Max'].map(
    (id): DirectVideoModel => ({
      provider: 'minimax',
      id,
      label: id.replace('MiniMax-', 'MiniMax '),
      protocol: 'minimax-v2',
      text: {
        maxPromptLength: 7000,
        durations: range(id === 'MiniMax-H3-Max' ? 5 : 4, 15),
        aspectRatios: ratios,
        resolutions: id === 'MiniMax-H3' ? ['768P', '2K'] : ['480P', '768P'],
        defaults: { duration: 5, resolution: '768P', ratio: '16:9' },
      },
    })
  ),
  ...['hailuo-2.3', 'hailuo-02'].map(
    (id): DirectVideoModel => ({
      provider: 'minimax',
      id,
      label: id === 'hailuo-2.3' ? 'Hailuo 2.3' : 'Hailuo 02',
      aliases: [id === 'hailuo-2.3' ? 'MiniMax-Hailuo-2.3' : 'MiniMax-Hailuo-02'],
      protocol: 'minimax-v1',
      text: {
        durations: [6, 10],
        resolutions: ['768P', '1080P'],
        promptOptimizer: true,
        defaults: { duration: 6, resolution: '768P' },
      },
    })
  ),
  ...['T2V-01', 'T2V-01-Director'].map(
    (id): DirectVideoModel => ({
      provider: 'minimax',
      id,
      label: id,
      protocol: 'minimax-v1',
      text: {
        durations: [6],
        resolutions: ['720P'],
        promptOptimizer: true,
        defaults: { duration: 6, resolution: '720P' },
      },
    })
  ),
  ...(
    [
      ['kling-video/v3.0-turbo/text-to-video', 'Kling 3.0 Turbo'],
      ['kling-video/v3.0/pro/text-to-video', 'Kling 3.0 Pro'],
      ['kling-video/v3.0/std/text-to-video', 'Kling 3.0 Standard'],
    ] as const
  ).map(
    ([id, label]): DirectVideoModel => ({
      provider: 'higgsfield',
      id,
      label,
      protocol: 'higgsfield',
      ...(id.includes('turbo')
        ? {
            text: {
              maxPromptLength: 3072,
              durations: range(3, 15),
              aspectRatios: ['16:9', '9:16', '1:1'],
              resolutions: ['720p', '1080p'],
            },
          }
        : {
            audioField: 'sound',
            text: {
              maxPromptLength: 2500,
              durations: range(3, 15),
              aspectRatios: ['16:9', '9:16', '1:1'],
              audio: true,
            },
          }),
    })
  ),
  {
    provider: 'higgsfield',
    id: 'kling-video/v2.5-turbo/pro/text-to-video',
    label: 'Kling 2.5 Turbo Pro',
    protocol: 'higgsfield',
    text: { durations: [5, 10] },
  },
  {
    provider: 'higgsfield',
    id: 'bytedance/seedance-2.0/text-to-video',
    label: 'Seedance 2.0',
    protocol: 'higgsfield',
    audioField: 'generate_audio',
    text: {
      durations: range(4, 15),
      aspectRatios: ratios,
      resolutions: ['480p', '720p', '1080p', '4k'],
      audio: true,
    },
  },
  {
    provider: 'higgsfield',
    id: 'minimax/h3/text-to-video',
    label: 'MiniMax H3',
    protocol: 'higgsfield',
    text: { maxPromptLength: 7000, durations: range(5, 15), aspectRatios: ratios },
  },
  {
    provider: 'higgsfield',
    id: 'minimax/hailuo-2.3/standard/text-to-video',
    label: 'Hailuo 2.3 Standard',
    protocol: 'higgsfield',
    text: { durations: [6, 10], promptOptimizer: true },
  },
]

export const directVideoDefaults = {
  runway: 'gen4_turbo',
  veo: 'gemini-omni-1.1-flash',
  luma: 'ray-2',
  minimax: 'hailuo-2.3',
  higgsfield: 'kling-video/v3.0-turbo/text-to-video',
} as const
const byId = new Map(directVideoModels.map((model) => [`${model.provider}:${model.id}`, model]))
for (const model of directVideoModels) {
  for (const alias of model.aliases ?? []) byId.set(`${model.provider}:${alias}`, model)
}
export function getDirectVideoModel(provider: unknown, id: unknown, withImage = false) {
  if (typeof provider !== 'string') return undefined
  const fallback = directVideoDefaults[provider as keyof typeof directVideoDefaults]
  if (id === undefined || id === '') id = fallback
  if (typeof id !== 'string') return undefined
  const key = `${provider}:${id}`
  const model = byId.get(key)
  if (!model) return undefined
  return { ...model, settings: withImage ? model.image : model.text }
}
