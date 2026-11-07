import { isRecordLike } from '@sim/utils/object'
import { VideoIcon } from '@/components/icons'
import {
  directVideoDefaults,
  directVideoModels,
  getDirectVideoModel,
} from '@/lib/media/direct-video-catalog'
import {
  type FalVideoSettings,
  falVideoModels,
  getFalVideoModel,
  getFalVideoVariant,
} from '@/lib/media/fal-video-catalog'
import {
  type CanonicalGroup,
  type CanonicalModeOverrides,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import { AuthMode, type BlockConfig, IntegrationType, type SubBlockConfig } from '@/blocks/types'
import { normalizeFileInput, parseOptionalBooleanInput } from '@/blocks/utils'

const FALAI_PREVIOUS_MODEL_OPTIONS = [
  { label: 'Google Veo 3.1', id: 'veo-3.1' },
  { label: 'OpenAI Sora 2', id: 'sora-2' },
  { label: 'Kling 2.5 Turbo Pro', id: 'kling-2.5-turbo-pro' },
  { label: 'Kling 2.1 Pro', id: 'kling-2.1-pro' },
  { label: 'MiniMax Hailuo 2.3 Pro', id: 'minimax-hailuo-2.3-pro' },
  { label: 'MiniMax Hailuo 2.3 Standard', id: 'minimax-hailuo-2.3-standard' },
  { label: 'WAN 2.1', id: 'wan-2.1' },
  { label: 'LTXV 0.9.8', id: 'ltxv-0.9.8' },
]

const FALAI_VEO_MODELS = ['veo-3.1', 'veo-3.1-fast']
const FALAI_SORA_MODELS = ['sora-2', 'sora-2-pro']
const FALAI_SEEDANCE_STANDARD_MODELS = ['seedance-2.0']
const FALAI_SEEDANCE_FAST_MODELS = ['seedance-2.0-fast']
const FALAI_SEEDANCE_MODELS = [...FALAI_SEEDANCE_STANDARD_MODELS, ...FALAI_SEEDANCE_FAST_MODELS]
const FALAI_KLING_LATEST_MODELS = ['kling-v3-pro', 'kling-v3-4k', 'kling-o3-pro', 'kling-o3-4k']
const FALAI_KLING_LEGACY_MODELS = ['kling-2.5-turbo-pro', 'kling-2.1-pro']
const FALAI_MINIMAX_STANDARD_MODELS = ['minimax-hailuo-2.3-standard', 'minimax-hailuo-02-standard']
const FALAI_MINIMAX_PRO_MODELS = ['minimax-hailuo-2.3-pro', 'minimax-hailuo-02-pro']
const FALAI_WAN_MODELS = ['wan-2.2-a14b-turbo']
const FALAI_LTX_MODELS = ['ltx-2.3', 'ltx-2.3-fast']
const FALAI_AUDIO_DEFAULT_ON_MODELS = [
  ...FALAI_VEO_MODELS,
  ...FALAI_SEEDANCE_MODELS,
  'kling-v3-pro',
  'kling-v3-4k',
  ...FALAI_LTX_MODELS,
]
const FALAI_AUDIO_DEFAULT_OFF_MODELS = ['kling-o3-pro', 'kling-o3-4k']

const FAL_MODEL_DEFAULT = { id: 'default', label: 'Model default' } as const
const endpointModels = falVideoModels.filter((model) => !model.legacyId)

// Never list these optional fields in `dependsOn`: an array there disables the field until every
// entry has a value. Options and conditions already re-read all block values on any change.
const START_FRAME_FIELDS = ['visualReferenceInput', 'visualReferenceUpload']
const HIDDEN = { field: 'provider', value: [] }

const START_FRAME_GROUP: CanonicalGroup = {
  canonicalId: 'visualReference',
  basicId: 'visualReferenceUpload',
  advancedIds: ['visualReferenceInput'],
}

/**
 * Whether the run will send a start frame: the serialized `visualReference`, or else only the
 * upload/reference member in the active mode, since the serializer drops the inactive one.
 */
function hasStartFrame(values?: Record<string, unknown>) {
  if (!values) return false
  const overrides = isRecordLike(values.__canonicalModes)
    ? (values.__canonicalModes as CanonicalModeOverrides)
    : undefined
  const reference =
    values.visualReference ?? resolveActiveCanonicalValue(START_FRAME_GROUP, values, overrides)
  return Array.isArray(reference) ? reference.length > 0 : Boolean(reference)
}

/** Settings of the endpoint a fal run will call: image-to-video once a start frame is attached. */
function selectedFalSettings(values?: Record<string, unknown>) {
  const model = getFalVideoModel(values?.model)
  return getFalVideoVariant(values?.model, Boolean(model?.image) && hasStartFrame(values))
}

type FalSettingKey = 'durations' | 'aspectRatios' | 'resolutions' | 'audioField' | 'promptOptimizer'

function tuningField(id: string, title: string, key: FalSettingKey): SubBlockConfig {
  return {
    id,
    title,
    type: 'dropdown',
    value: () => FAL_MODEL_DEFAULT.id,
    condition: (values) => {
      const model = getFalVideoModel(values?.model)
      return model && !model.legacyId && selectedFalSettings(values)?.[key]
        ? { field: 'provider', value: 'falai' }
        : HIDDEN
    },
    dependsOn: ['model'],
    options: (params) => {
      if (!params) {
        const values = endpointModels.flatMap((model) =>
          [model, model.image].flatMap((settings) => {
            const choices = settings?.[key]
            return Array.isArray(choices)
              ? choices.map((value) =>
                  key === 'durations' ? String(Number.parseFloat(String(value))) : String(value)
                )
              : choices
                ? ['true', 'false']
                : []
          })
        )
        return [FAL_MODEL_DEFAULT, ...[...new Set(values)].map((id) => ({ id, label: id }))]
      }
      const model = selectedFalSettings(params?.values)
      if (!model?.[key]) return []
      if (key === 'audioField' || key === 'promptOptimizer') {
        return [FAL_MODEL_DEFAULT, { id: 'true', label: 'On' }, { id: 'false', label: 'Off' }]
      }
      const duration = Number(params?.values.falDuration)
      const resolution = params?.values.falResolution
      const limit =
        typeof resolution === 'string' ? model.maxDurationByResolution?.[resolution] : undefined
      const choices = (model[key] ?? []).flatMap((value) => {
        const seconds = Number.parseFloat(String(value))
        if (key === 'durations' && limit !== undefined && seconds > limit) return []
        if (
          key === 'resolutions' &&
          duration > (model.maxDurationByResolution?.[value] ?? Number.POSITIVE_INFINITY)
        )
          return []
        const option = key === 'durations' ? String(seconds) : String(value)
        return [{ id: option, label: option }]
      })
      return [FAL_MODEL_DEFAULT, ...choices]
    },
  }
}

/** Separate IDs keep saved provider settings from seeding a newly selected endpoint. */
const falVideoFields = [
  tuningField('falDuration', 'Duration (seconds)', 'durations'),
  tuningField('falAspectRatio', 'Aspect Ratio', 'aspectRatios'),
  tuningField('falResolution', 'Resolution', 'resolutions'),
  tuningField('falGenerateAudio', 'Generate Audio', 'audioField'),
  tuningField('falPromptOptimizer', 'Prompt Optimizer', 'promptOptimizer'),
]

/** Settings fields that models with a legacy ID keep, and the catalog setting each one sets. */
const LEGACY_FAL_SETTING_KEYS: Record<string, keyof FalVideoSettings> = {
  duration: 'durations',
  aspectRatio: 'aspectRatios',
  resolution: 'resolutions',
  generateAudio: 'audioField',
  promptOptimizer: 'promptOptimizer',
}

/**
 * Drops a stored setting the endpoint a run calls rejects but the model's other endpoint accepts,
 * so the model default applies. Attaching or removing a start frame switches endpoints without
 * clearing settings picked for the other one: Seedance 2.5 takes `16:9` from a prompt but only
 * `auto` from a start frame. Any other value passes through to the request's own legacy mapping
 * and validation.
 */
function dropStaleSetting(
  value: unknown,
  allowed: readonly (number | string)[] | undefined,
  otherAllowed: readonly (number | string)[] | undefined,
  numeric = false
) {
  const normalize = (choice: unknown) => (numeric ? Number.parseFloat(String(choice)) : choice)
  const accepts = (choices?: readonly (number | string)[]) =>
    choices?.some((choice) => normalize(choice) === normalize(value)) ?? false
  return value !== undefined && !accepts(allowed) && accepts(otherAllowed) ? undefined : value
}

function keepFalSettingsAllowed(
  params: Record<string, unknown>,
  settings: FalVideoSettings | undefined,
  other: FalVideoSettings | undefined
) {
  return {
    ...params,
    duration: dropStaleSetting(params.duration, settings?.durations, other?.durations, true),
    aspectRatio: dropStaleSetting(params.aspectRatio, settings?.aspectRatios, other?.aspectRatios),
    resolution: dropStaleSetting(params.resolution, settings?.resolutions, other?.resolutions),
    generateAudio: settings?.audioField ? params.generateAudio : undefined,
    promptOptimizer: settings?.promptOptimizer ? params.promptOptimizer : undefined,
  }
}

function withFalVideoCatalog(subBlocks: SubBlockConfig[]): SubBlockConfig[] {
  return subBlocks.flatMap((subBlock) => {
    const condition = subBlock.condition
    if (
      typeof condition !== 'object' ||
      condition?.field !== 'provider' ||
      condition.value !== 'falai'
    ) {
      return [subBlock]
    }
    if (subBlock.id === 'model') {
      return [
        {
          ...subBlock,
          searchable: true,
          options: [
            ...falVideoModels
              .map((model) => ({
                id: model.modelId,
                label: model.label,
                description: model.endpoint,
              }))
              .sort((left, right) =>
                left.label.localeCompare(right.label, 'en', { numeric: true })
              ),
            { id: 'sora-2', label: 'OpenAI Sora 2 (retired)', hidden: true },
            { id: 'sora-2-pro', label: 'OpenAI Sora 2 Pro (retired)', hidden: true },
          ],
        },
      ]
    }
    if (subBlock.id === 'apiKey' && !condition.not) return [...falVideoFields, subBlock]
    const key = LEGACY_FAL_SETTING_KEYS[subBlock.id]
    if (key)
      return [
        {
          ...subBlock,
          condition: (values) => {
            const image = getFalVideoModel(values?.model)?.image
            return image && !image[key] && hasStartFrame(values) ? HIDDEN : condition
          },
        },
      ]
    return [subBlock]
  })
}

function selectedDirectModel(values?: Record<string, unknown>) {
  return getDirectVideoModel(values?.provider, values?.model, hasStartFrame(values))
}

const directVideoFields = (
  [
    ['duration', 'Duration (seconds)', 'durations'],
    ['aspectRatio', 'Aspect Ratio', 'aspectRatios'],
    ['resolution', 'Resolution', 'resolutions'],
    ['directGenerateAudio', 'Generate Audio', 'audio'],
    ['promptOptimizer', 'Prompt Optimizer', 'promptOptimizer'],
  ] as const
).map(
  ([id, title, key]): SubBlockConfig => ({
    id,
    title,
    type: key === 'promptOptimizer' ? 'switch' : 'dropdown',
    value: key === 'promptOptimizer' ? undefined : () => FAL_MODEL_DEFAULT.id,
    dependsOn: ['provider', 'model'],
    condition: (values) => ({
      field: 'provider',
      value: selectedDirectModel(values)?.settings?.[key] ? [String(values?.provider)] : [],
    }),
    options: (params) => {
      if (!params) {
        const values = directVideoModels.flatMap((model) =>
          [model.text, model.image].flatMap((settings) => {
            const choices = settings?.[key]
            return Array.isArray(choices) ? choices.map(String) : choices ? ['true', 'false'] : []
          })
        )
        return [FAL_MODEL_DEFAULT, ...[...new Set(values)].map((id) => ({ id, label: id }))]
      }
      const model = selectedDirectModel(params?.values)
      const choices = model?.settings?.[key]
      if (!choices) return []
      if (typeof choices === 'boolean')
        return [FAL_MODEL_DEFAULT, { id: 'true', label: 'On' }, { id: 'false', label: 'Off' }]
      return [
        FAL_MODEL_DEFAULT,
        ...choices
          .filter((value) => {
            if (model?.protocol !== 'minimax-v1') return true
            if (key === 'durations' && params?.values.resolution === '1080P') return value === 6
            if (key === 'resolutions' && Number(params?.values.duration) === 10)
              return value !== '1080P'
            return true
          })
          .map((value) => ({ id: String(value), label: String(value) })),
      ]
    },
  })
)

function withDirectVideoCatalog(subBlocks: SubBlockConfig[]): SubBlockConfig[] {
  return subBlocks.flatMap((field): SubBlockConfig[] => {
    if (
      field.id === 'model' &&
      typeof field.condition === 'object' &&
      field.condition.value === 'falai'
    ) {
      const options = field.options
      return [
        {
          ...field,
          options: (params) => {
            const falOptions = typeof options === 'function' ? options(params) : (options ?? [])
            return params
              ? falOptions
              : [
                  ...falOptions,
                  ...directVideoModels.flatMap((model) => [
                    { id: model.id, label: model.label },
                    ...(model.aliases ?? []).map((id) => ({
                      id,
                      label: model.label,
                      hidden: true,
                    })),
                  ]),
                ]
          },
        },
      ]
    }
    if (field.id === 'provider')
      return [
        {
          ...field,
          options: [
            { id: 'runway', label: 'Runway' },
            { id: 'veo', label: 'Google Gemini' },
            { id: 'luma', label: 'Luma' },
            { id: 'minimax', label: 'MiniMax' },
            { id: 'higgsfield', label: 'Higgsfield' },
            { id: 'falai', label: 'Fal.ai (Multi-Model)' },
          ],
        },
        ...(['runway', 'veo', 'luma', 'minimax', 'higgsfield'] as const).map(
          (provider): SubBlockConfig => ({
            id: 'model',
            title: 'Model',
            type: 'dropdown',
            searchable: true,
            condition: { field: 'provider', value: provider },
            options: directVideoModels
              .filter((model) => model.provider === provider)
              .flatMap((model) => [
                { id: model.id, label: model.label },
                ...(model.aliases ?? []).map((id) => ({ id, label: model.label, hidden: true })),
              ]),
            value: () => directVideoDefaults[provider],
            dependsOn: ['provider'],
            required: true,
          })
        ),
      ]
    if (field.id === 'prompt') return [field, ...directVideoFields]
    const condition = field.condition
    const isDirect =
      typeof condition === 'object' &&
      condition.field === 'provider' &&
      typeof condition.value === 'string' &&
      condition.value !== 'falai'
    if (
      isDirect &&
      ['model', 'duration', 'aspectRatio', 'resolution', 'promptOptimizer'].includes(field.id)
    )
      return []
    if (field.id === 'endpoint')
      return [
        {
          ...field,
          condition: {
            field: 'provider',
            value: 'minimax',
            and: { field: 'model', value: ['hailuo-2.3', 'hailuo-02'] },
          },
          dependsOn: ['provider', 'model'],
        },
      ]
    if (field.id === 'cameraControl')
      return [
        {
          ...field,
          condition: {
            field: 'provider',
            value: 'luma',
            and: { field: 'model', value: ['ray-2', 'ray-flash-2'] },
          },
          dependsOn: ['provider', 'model'],
        },
      ]
    if (START_FRAME_FIELDS.includes(field.id))
      return [
        {
          ...field,
          condition: (values) =>
            values?.provider === 'runway' ||
            (values?.provider === 'falai' && getFalVideoModel(values.model)?.image)
              ? { field: 'provider', value: ['runway', 'falai'] }
              : HIDDEN,
          dependsOn: ['provider', 'model'],
          required: { field: 'model', value: ['gen4_turbo', 'gen-4', 'gen-4-turbo'] },
        },
      ]
    return [field]
  })
}

export const VideoGeneratorBlock: BlockConfig = {
  type: 'video_generator',
  name: 'Video Generator (Legacy)',
  description: 'Generate videos from text using AI',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'video_generator_v3' },
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate high-quality videos from text prompts using leading AI providers. Supports multiple models, aspect ratios, resolutions, and provider-specific features like world consistency, camera controls, and audio generation.',
  docsLink: 'https://docs.sim.ai/integrations/video-generator',
  category: 'blocks',
  integrationType: IntegrationType.AI,
  bgColor: '#181C1E',
  icon: VideoIcon,
  canvasPresentation: {
    defaultTitle: 'Video Generator',
    sentences: {
      default: [
        { text: 'Generate a video from', field: 'prompt', core: true },
        { text: ', using', field: 'model' },
      ],
    },
  },

  subBlocks: [
    // Provider selection
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'Runway Gen-4', id: 'runway' },
        { label: 'Google Veo 3', id: 'veo' },
        { label: 'Luma Dream Machine', id: 'luma' },
        { label: 'MiniMax Hailuo', id: 'minimax' },
        { label: 'Fal.ai (Multi-Model)', id: 'falai' },
      ],
      value: () => 'falai',
      required: true,
    },

    // Note: Runway Gen-4 only supports Gen-4 Turbo for image-to-video (no model selection needed)

    // Google Veo model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: 'Veo 3', id: 'veo-3' },
        { label: 'Veo 3 Fast', id: 'veo-3-fast' },
        { label: 'Veo 3.1', id: 'veo-3.1' },
      ],
      value: () => 'veo-3',
      dependsOn: ['provider'],
      required: false,
    },

    // Luma model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [{ label: 'Ray 2', id: 'ray-2' }],
      value: () => 'ray-2',
      dependsOn: ['provider'],
      required: false,
    },

    // MiniMax model and endpoint selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'minimax' },
      options: [
        { label: 'Hailuo 2.3', id: 'hailuo-2.3' },
        { label: 'Hailuo-02', id: 'hailuo-02' },
      ],
      value: () => 'hailuo-2.3',
      dependsOn: ['provider'],
      required: false,
    },

    {
      id: 'endpoint',
      title: 'Quality Endpoint',
      type: 'dropdown',
      condition: { field: 'provider', value: 'minimax' },
      options: [
        { label: 'Pro', id: 'pro' },
        { label: 'Standard', id: 'standard' },
      ],
      value: () => 'standard',
      dependsOn: ['provider'],
      required: false,
    },

    // Fal.ai model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'falai' },
      options: FALAI_PREVIOUS_MODEL_OPTIONS,
      value: () => 'veo-3.1',
      dependsOn: ['provider'],
      required: true,
    },

    // Prompt input (required)
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Describe the video you want to generate...',
      required: true,
    },

    // Duration selection - Runway (5 or 10 seconds)
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'runway' },
      options: [
        { label: '5', id: '5' },
        { label: '10', id: '10' },
      ],
      value: () => '5',
      dependsOn: ['provider'],
      required: false,
    },

    // Duration selection - Veo (4, 6, or 8 seconds)
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: '4', id: '4' },
        { label: '6', id: '6' },
        { label: '8', id: '8' },
      ],
      value: () => '8',
      dependsOn: ['provider'],
      required: false,
    },

    // Duration selection - Luma (5 or 9 seconds)
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [
        { label: '5', id: '5' },
        { label: '9', id: '9' },
      ],
      value: () => '5',
      dependsOn: ['provider'],
      required: false,
    },

    // Duration selection - MiniMax (6 or 10 seconds)
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'minimax' },
      options: [
        { label: '6', id: '6' },
        { label: '10', id: '10' },
      ],
      value: () => '6',
      dependsOn: ['provider'],
      required: false,
    },

    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_VEO_MODELS },
      },
      options: [
        { label: '4', id: '4' },
        { label: '6', id: '6' },
        { label: '8', id: '8' },
      ],
      value: () => '8',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SORA_MODELS },
      },
      options: [
        { label: '4', id: '4' },
        { label: '8', id: '8' },
        { label: '12', id: '12' },
        { label: '16', id: '16' },
        { label: '20', id: '20' },
      ],
      value: () => '4',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_MODELS },
      },
      options: [
        { label: '4', id: '4' },
        { label: '5', id: '5' },
        { label: '6', id: '6' },
        { label: '7', id: '7' },
        { label: '8', id: '8' },
        { label: '9', id: '9' },
        { label: '10', id: '10' },
        { label: '11', id: '11' },
        { label: '12', id: '12' },
        { label: '13', id: '13' },
        { label: '14', id: '14' },
        { label: '15', id: '15' },
      ],
      value: () => '5',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_KLING_LATEST_MODELS },
      },
      options: [
        { label: '3', id: '3' },
        { label: '4', id: '4' },
        { label: '5', id: '5' },
        { label: '6', id: '6' },
        { label: '7', id: '7' },
        { label: '8', id: '8' },
        { label: '9', id: '9' },
        { label: '10', id: '10' },
        { label: '11', id: '11' },
        { label: '12', id: '12' },
        { label: '13', id: '13' },
        { label: '14', id: '14' },
        { label: '15', id: '15' },
      ],
      value: () => '5',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_KLING_LEGACY_MODELS },
      },
      options: [
        { label: '5', id: '5' },
        { label: '8', id: '8' },
        { label: '10', id: '10' },
      ],
      value: () => '5',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_MINIMAX_STANDARD_MODELS },
      },
      options: [
        { label: '6', id: '6' },
        { label: '10', id: '10' },
      ],
      value: () => '6',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'ltx-2.3' },
      },
      options: [
        { label: '6', id: '6' },
        { label: '8', id: '8' },
        { label: '10', id: '10' },
      ],
      value: () => '6',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'ltx-2.3-fast' },
      },
      options: [
        { label: '6', id: '6' },
        { label: '8', id: '8' },
        { label: '10', id: '10' },
        { label: '12', id: '12' },
        { label: '14', id: '14' },
        { label: '16', id: '16' },
        { label: '18', id: '18' },
        { label: '20', id: '20' },
      ],
      value: () => '6',
      dependsOn: ['model'],
      required: false,
    },

    // Aspect ratio selection - Veo (only 16:9 and 9:16)
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => '16:9',
      dependsOn: ['provider'],
      required: false,
    },

    // Aspect ratio selection - Runway (includes 1:1)
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: { field: 'provider', value: 'runway' },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '1:1', id: '1:1' },
      ],
      value: () => '16:9',
      dependsOn: ['provider'],
      required: false,
    },

    // Aspect ratio selection - Luma (includes 1:1)
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '1:1', id: '1:1' },
      ],
      value: () => '16:9',
      dependsOn: ['provider'],
      required: false,
    },

    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: {
          field: 'model',
          value: [...FALAI_VEO_MODELS, ...FALAI_SORA_MODELS, ...FALAI_LTX_MODELS],
        },
      },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => '16:9',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_MODELS },
      },
      options: [
        { label: 'Auto', id: 'auto' },
        { label: '21:9', id: '21:9' },
        { label: '16:9', id: '16:9' },
        { label: '4:3', id: '4:3' },
        { label: '1:1', id: '1:1' },
        { label: '3:4', id: '3:4' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => 'auto',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: [...FALAI_KLING_LATEST_MODELS, ...FALAI_WAN_MODELS] },
      },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '1:1', id: '1:1' },
      ],
      value: () => '16:9',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_KLING_LEGACY_MODELS },
      },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => '16:9',
      dependsOn: ['model'],
      required: false,
    },

    // Note: MiniMax aspect ratio is fixed at 16:9 (not configurable)

    // Note: Runway Gen-4 Turbo outputs at 720p natively (no resolution selector needed)

    // Resolution selection - Veo
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
      ],
      value: () => '1080p',
      dependsOn: ['provider'],
      required: false,
    },

    // Resolution selection - Luma
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [
        { label: '540p', id: '540p' },
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
      ],
      value: () => '1080p',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_VEO_MODELS },
      },
      options: [
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
        { label: '4K', id: '4k' },
      ],
      value: () => '1080p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'sora-2' },
      },
      options: [{ label: '720p', id: '720p' }],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'sora-2-pro' },
      },
      options: [
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
        { label: 'True 1080p', id: 'true_1080p' },
      ],
      value: () => '1080p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_STANDARD_MODELS },
      },
      options: [
        { label: '480p', id: '480p' },
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
      ],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_FAST_MODELS },
      },
      options: [
        { label: '480p', id: '480p' },
        { label: '720p', id: '720p' },
      ],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_WAN_MODELS },
      },
      options: [
        { label: '480p', id: '480p' },
        { label: '580p', id: '580p' },
        { label: '720p', id: '720p' },
      ],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_LTX_MODELS },
      },
      options: [
        { label: '1080p', id: '1080p' },
        { label: '1440p', id: '1440p' },
        { label: '2160p', id: '2160p' },
      ],
      value: () => '1080p',
      dependsOn: ['model'],
      required: false,
    },

    // Note: MiniMax resolution is fixed per endpoint (Pro=1080p for 6s, Standard=768p)

    // Runway-specific: Visual reference (REQUIRED for Gen-4)
    {
      id: 'visualReference',
      title: 'Reference Image',
      type: 'file-upload',
      condition: { field: 'provider', value: 'runway' },
      placeholder: 'Upload reference image',
      mode: 'basic',
      multiple: false,
      dependsOn: ['provider'],
      required: true,
      acceptedTypes: '.jpg,.jpeg,.png,.webp',
    },

    // Luma-specific: Camera controls
    {
      id: 'cameraControl',
      title: 'Camera Controls',
      type: 'long-input',
      condition: { field: 'provider', value: 'luma' },
      placeholder: 'JSON: [{ "key": "pan_right" }, { "key": "zoom_in" }]',
      dependsOn: ['provider'],
      required: false,
    },

    // MiniMax-specific: Prompt optimizer
    {
      id: 'promptOptimizer',
      title: 'Prompt Optimizer',
      type: 'switch',
      condition: { field: 'provider', value: 'minimax' },
      dependsOn: ['provider'],
    },
    {
      id: 'promptOptimizer',
      title: 'Prompt Optimizer',
      type: 'switch',
      defaultValue: true,
      condition: {
        field: 'provider',
        value: 'falai',
        and: {
          field: 'model',
          value: [...FALAI_MINIMAX_PRO_MODELS, ...FALAI_MINIMAX_STANDARD_MODELS],
        },
      },
      dependsOn: ['model'],
    },
    {
      id: 'generateAudio',
      title: 'Generate Audio',
      type: 'switch',
      defaultValue: true,
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_AUDIO_DEFAULT_ON_MODELS },
      },
      dependsOn: ['model'],
    },
    {
      id: 'generateAudio',
      title: 'Generate Audio',
      type: 'switch',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_AUDIO_DEFAULT_OFF_MODELS },
      },
      dependsOn: ['model'],
    },

    // API Key
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
      hideWhenHosted: true,
      condition: { field: 'provider', value: 'falai' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
      condition: { field: 'provider', value: 'falai', not: true },
    },
  ],

  tools: {
    access: ['video_runway', 'video_veo', 'video_luma', 'video_minimax', 'video_falai'],
    config: {
      tool: (params) => {
        // Select tool based on provider
        switch (params.provider) {
          case 'runway':
            return 'video_runway'
          case 'veo':
            return 'video_veo'
          case 'luma':
            return 'video_luma'
          case 'minimax':
            return 'video_minimax'
          case 'falai':
            return 'video_falai'
          default:
            return 'video_runway'
        }
      },
      params: (params) => ({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        endpoint: params.endpoint,
        prompt: params.prompt,
        duration: params.duration ? Number(params.duration) : undefined,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        visualReference: params.visualReference,
        consistencyMode: params.consistencyMode,
        stylePreset: params.stylePreset,
        promptOptimizer: parseOptionalBooleanInput(params.promptOptimizer),
        generateAudio: parseOptionalBooleanInput(params.generateAudio),
        cameraControl: params.cameraControl
          ? typeof params.cameraControl === 'string'
            ? JSON.parse(params.cameraControl)
            : params.cameraControl
          : undefined,
      }),
    },
  },

  inputs: {
    provider: {
      type: 'string',
      description: 'Video generation provider (runway, veo, luma, minimax, falai)',
    },
    apiKey: { type: 'string', description: 'Provider API key' },
    model: {
      type: 'string',
      description: 'Provider-specific model',
    },
    endpoint: {
      type: 'string',
      description: 'Quality endpoint for MiniMax (pro, standard)',
    },
    prompt: { type: 'string', description: 'Text prompt for video generation' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    aspectRatio: {
      type: 'string',
      description: 'Aspect ratio for supported providers and models',
    },
    resolution: {
      type: 'string',
      description: 'Video resolution for supported providers and models',
    },
    visualReference: { type: 'json', description: 'Reference image for Runway (UserFile)' },
    consistencyMode: {
      type: 'string',
      description: 'Consistency mode for Runway (character, object, style, location)',
    },
    stylePreset: { type: 'string', description: 'Style preset for Runway' },
    promptOptimizer: {
      type: 'boolean',
      description: 'Enable prompt optimization for MiniMax (default: true)',
    },
    generateAudio: {
      type: 'boolean',
      description: 'Generate native audio when supported by the selected model',
    },
    cameraControl: {
      type: 'json',
      description: 'Camera controls for Luma (pan, zoom, tilt, truck, tracking)',
    },
  },

  outputs: {
    videoUrl: { type: 'string', description: 'Generated video URL' },
    videoFile: { type: 'file', description: 'Video file object with metadata' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    width: { type: 'number', description: 'Video width in pixels' },
    height: { type: 'number', description: 'Video height in pixels' },
    provider: { type: 'string', description: 'Provider used' },
    model: { type: 'string', description: 'Model used' },
  },
}

export const VideoGeneratorV2Block: BlockConfig = {
  ...VideoGeneratorBlock,
  type: 'video_generator_v2',
  name: 'Video Generator',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'video_generator_v3' },
  subBlocks: [
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'Runway Gen-4', id: 'runway' },
        { label: 'Google Veo 3', id: 'veo' },
        { label: 'Luma Dream Machine', id: 'luma' },
        { label: 'MiniMax Hailuo', id: 'minimax' },
        { label: 'Fal.ai (Multi-Model)', id: 'falai' },
      ],
      commandSearchable: true,
      value: () => 'falai',
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: 'Veo 3', id: 'veo-3' },
        { label: 'Veo 3 Fast', id: 'veo-3-fast' },
        { label: 'Veo 3.1', id: 'veo-3.1' },
      ],
      value: () => 'veo-3',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [{ label: 'Ray 2', id: 'ray-2' }],
      value: () => 'ray-2',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'minimax' },
      options: [
        { label: 'Hailuo 2.3', id: 'hailuo-2.3' },
        { label: 'Hailuo-02', id: 'hailuo-02' },
      ],
      value: () => 'hailuo-2.3',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'endpoint',
      title: 'Quality Endpoint',
      type: 'dropdown',
      condition: { field: 'provider', value: 'minimax' },
      options: [
        { label: 'Pro', id: 'pro' },
        { label: 'Standard', id: 'standard' },
      ],
      value: () => 'standard',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'falai' },
      options: FALAI_PREVIOUS_MODEL_OPTIONS,
      value: () => 'veo-3.1',
      dependsOn: ['provider'],
      required: true,
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Describe the video you want to generate...',
      required: true,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'runway' },
      options: [
        { label: '5', id: '5' },
        { label: '10', id: '10' },
      ],
      value: () => '5',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: '4', id: '4' },
        { label: '6', id: '6' },
        { label: '8', id: '8' },
      ],
      value: () => '8',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [
        { label: '5', id: '5' },
        { label: '9', id: '9' },
      ],
      value: () => '5',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: { field: 'provider', value: 'minimax' },
      options: [
        { label: '6', id: '6' },
        { label: '10', id: '10' },
      ],
      value: () => '6',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_VEO_MODELS },
      },
      options: [
        { label: '4', id: '4' },
        { label: '6', id: '6' },
        { label: '8', id: '8' },
      ],
      value: () => '8',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SORA_MODELS },
      },
      options: [
        { label: '4', id: '4' },
        { label: '8', id: '8' },
        { label: '12', id: '12' },
        { label: '16', id: '16' },
        { label: '20', id: '20' },
      ],
      value: () => '4',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_MODELS },
      },
      options: [
        { label: '4', id: '4' },
        { label: '5', id: '5' },
        { label: '6', id: '6' },
        { label: '7', id: '7' },
        { label: '8', id: '8' },
        { label: '9', id: '9' },
        { label: '10', id: '10' },
        { label: '11', id: '11' },
        { label: '12', id: '12' },
        { label: '13', id: '13' },
        { label: '14', id: '14' },
        { label: '15', id: '15' },
      ],
      value: () => '5',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_KLING_LATEST_MODELS },
      },
      options: [
        { label: '3', id: '3' },
        { label: '4', id: '4' },
        { label: '5', id: '5' },
        { label: '6', id: '6' },
        { label: '7', id: '7' },
        { label: '8', id: '8' },
        { label: '9', id: '9' },
        { label: '10', id: '10' },
        { label: '11', id: '11' },
        { label: '12', id: '12' },
        { label: '13', id: '13' },
        { label: '14', id: '14' },
        { label: '15', id: '15' },
      ],
      value: () => '5',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_KLING_LEGACY_MODELS },
      },
      options: [
        { label: '5', id: '5' },
        { label: '8', id: '8' },
        { label: '10', id: '10' },
      ],
      value: () => '5',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_MINIMAX_STANDARD_MODELS },
      },
      options: [
        { label: '6', id: '6' },
        { label: '10', id: '10' },
      ],
      value: () => '6',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'ltx-2.3' },
      },
      options: [
        { label: '6', id: '6' },
        { label: '8', id: '8' },
        { label: '10', id: '10' },
      ],
      value: () => '6',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'duration',
      title: 'Duration (seconds)',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'ltx-2.3-fast' },
      },
      options: [
        { label: '6', id: '6' },
        { label: '8', id: '8' },
        { label: '10', id: '10' },
        { label: '12', id: '12' },
        { label: '14', id: '14' },
        { label: '16', id: '16' },
        { label: '18', id: '18' },
        { label: '20', id: '20' },
      ],
      value: () => '6',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => '16:9',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: { field: 'provider', value: 'runway' },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '1:1', id: '1:1' },
      ],
      value: () => '16:9',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '1:1', id: '1:1' },
      ],
      value: () => '16:9',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: {
          field: 'model',
          value: [...FALAI_VEO_MODELS, ...FALAI_SORA_MODELS, ...FALAI_LTX_MODELS],
        },
      },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => '16:9',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_MODELS },
      },
      options: [
        { label: 'Auto', id: 'auto' },
        { label: '21:9', id: '21:9' },
        { label: '16:9', id: '16:9' },
        { label: '4:3', id: '4:3' },
        { label: '1:1', id: '1:1' },
        { label: '3:4', id: '3:4' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => 'auto',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: [...FALAI_KLING_LATEST_MODELS, ...FALAI_WAN_MODELS] },
      },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '1:1', id: '1:1' },
      ],
      value: () => '16:9',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_KLING_LEGACY_MODELS },
      },
      options: [
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
      ],
      value: () => '16:9',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: { field: 'provider', value: 'veo' },
      options: [
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
      ],
      value: () => '1080p',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: { field: 'provider', value: 'luma' },
      options: [
        { label: '540p', id: '540p' },
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
      ],
      value: () => '1080p',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_VEO_MODELS },
      },
      options: [
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
        { label: '4K', id: '4k' },
      ],
      value: () => '1080p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'sora-2' },
      },
      options: [{ label: '720p', id: '720p' }],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'sora-2-pro' },
      },
      options: [
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
        { label: 'True 1080p', id: 'true_1080p' },
      ],
      value: () => '1080p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_STANDARD_MODELS },
      },
      options: [
        { label: '480p', id: '480p' },
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
      ],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_SEEDANCE_FAST_MODELS },
      },
      options: [
        { label: '480p', id: '480p' },
        { label: '720p', id: '720p' },
      ],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_WAN_MODELS },
      },
      options: [
        { label: '480p', id: '480p' },
        { label: '580p', id: '580p' },
        { label: '720p', id: '720p' },
      ],
      value: () => '720p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_LTX_MODELS },
      },
      options: [
        { label: '1080p', id: '1080p' },
        { label: '1440p', id: '1440p' },
        { label: '2160p', id: '2160p' },
      ],
      value: () => '1080p',
      dependsOn: ['model'],
      required: false,
    },
    {
      id: 'visualReferenceUpload',
      title: 'Reference Image',
      type: 'file-upload',
      canonicalParamId: 'visualReference',
      condition: { field: 'provider', value: 'runway' },
      placeholder: 'Upload reference image',
      mode: 'basic',
      multiple: false,
      dependsOn: ['provider'],
      required: true,
      acceptedTypes: '.jpg,.jpeg,.png,.webp',
    },
    {
      id: 'visualReferenceInput',
      title: 'Reference Image',
      type: 'short-input',
      canonicalParamId: 'visualReference',
      condition: { field: 'provider', value: 'runway' },
      placeholder: 'Reference image from previous blocks',
      mode: 'advanced',
      dependsOn: ['provider'],
      required: true,
    },
    {
      id: 'cameraControl',
      title: 'Camera Controls',
      type: 'long-input',
      condition: { field: 'provider', value: 'luma' },
      placeholder: 'JSON: [{ "key": "pan_right" }, { "key": "zoom_in" }]',
      dependsOn: ['provider'],
      required: false,
    },
    {
      id: 'promptOptimizer',
      title: 'Prompt Optimizer',
      type: 'switch',
      condition: { field: 'provider', value: 'minimax' },
      dependsOn: ['provider'],
    },
    {
      id: 'promptOptimizer',
      title: 'Prompt Optimizer',
      type: 'switch',
      defaultValue: true,
      condition: {
        field: 'provider',
        value: 'falai',
        and: {
          field: 'model',
          value: [...FALAI_MINIMAX_PRO_MODELS, ...FALAI_MINIMAX_STANDARD_MODELS],
        },
      },
      dependsOn: ['model'],
    },
    {
      id: 'generateAudio',
      title: 'Generate Audio',
      type: 'switch',
      defaultValue: true,
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_AUDIO_DEFAULT_ON_MODELS },
      },
      dependsOn: ['model'],
    },
    {
      id: 'generateAudio',
      title: 'Generate Audio',
      type: 'switch',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: FALAI_AUDIO_DEFAULT_OFF_MODELS },
      },
      dependsOn: ['model'],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
      hideWhenHosted: true,
      condition: { field: 'provider', value: 'falai' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
      condition: { field: 'provider', value: 'falai', not: true },
    },
  ],
  tools: {
    access: ['video_runway', 'video_veo', 'video_luma', 'video_minimax', 'video_falai'],
    config: {
      tool: (params) => {
        switch (params.provider) {
          case 'runway':
            return 'video_runway'
          case 'veo':
            return 'video_veo'
          case 'luma':
            return 'video_luma'
          case 'minimax':
            return 'video_minimax'
          case 'falai':
            return 'video_falai'
          default:
            return 'video_runway'
        }
      },
      params: (params) => {
        const model = params.provider === 'falai' ? getFalVideoModel(params.model) : undefined
        const useFalFields = model && !model.legacyId
        const setting = (legacy: string, catalog: string) => {
          const value = useFalFields ? (params[catalog] ?? params[legacy]) : params[legacy]
          return useFalFields && value === FAL_MODEL_DEFAULT.id ? undefined : value
        }
        const duration = setting('duration', 'falDuration')
        return {
          provider: params.provider,
          apiKey: params.apiKey,
          model: params.model,
          endpoint: params.endpoint,
          prompt: params.prompt,
          duration: duration ? Number(duration) : undefined,
          aspectRatio: setting('aspectRatio', 'falAspectRatio'),
          resolution: setting('resolution', 'falResolution'),
          visualReference: normalizeFileInput(params.visualReference, { single: true }),
          consistencyMode: params.consistencyMode,
          stylePreset: params.stylePreset,
          promptOptimizer: parseOptionalBooleanInput(
            setting('promptOptimizer', 'falPromptOptimizer')
          ),
          generateAudio: parseOptionalBooleanInput(setting('generateAudio', 'falGenerateAudio')),
          cameraControl: params.cameraControl
            ? typeof params.cameraControl === 'string'
              ? JSON.parse(params.cameraControl)
              : params.cameraControl
            : undefined,
        }
      },
    },
  },
  inputs: {
    provider: {
      type: 'string',
      description: 'Video generation provider (runway, veo, luma, minimax, falai)',
    },
    apiKey: { type: 'string', description: 'Provider API key' },
    model: {
      type: 'string',
      description: 'Provider-specific model',
    },
    endpoint: {
      type: 'string',
      description: 'Quality endpoint for MiniMax (pro, standard)',
    },
    prompt: { type: 'string', description: 'Text prompt for video generation' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    aspectRatio: {
      type: 'string',
      description: 'Aspect ratio for supported providers and models',
    },
    resolution: {
      type: 'string',
      description: 'Video resolution for supported providers and models',
    },
    visualReference: { type: 'json', description: 'Reference image for Runway (UserFile)' },
    consistencyMode: {
      type: 'string',
      description: 'Consistency mode for Runway (character, object, style, location)',
    },
    stylePreset: { type: 'string', description: 'Style preset for Runway' },
    promptOptimizer: {
      type: 'boolean',
      description: 'Enable prompt optimization for MiniMax (default: true)',
    },
    generateAudio: {
      type: 'boolean',
      description: 'Generate native audio when supported by the selected model',
    },
    cameraControl: {
      type: 'json',
      description: 'Camera controls for Luma (pan, zoom, tilt, truck, tracking)',
    },
  },
}

/** Lets a user type a model the catalog does not list yet, as well as pick a listed one. */
function withTypedModelFields(subBlocks: SubBlockConfig[]): SubBlockConfig[] {
  return subBlocks.map((field) =>
    field.id === 'model'
      ? {
          ...field,
          type: 'combobox',
          placeholder: 'Type or select a model...',
          mediaModelOptions: true,
          restoreDefaultWhenCleared: true,
        }
      : field
  )
}

export const VideoGeneratorV3Block: BlockConfig = {
  ...VideoGeneratorV2Block,
  sunset: undefined,
  type: 'video_generator_v3',
  name: 'Video Generator',
  description: 'Generate videos from text using AI',
  longDescription:
    'Generate high-quality videos from text prompts using leading AI providers. Supports Runway, Google Gemini, Luma, MiniMax, Higgsfield, and Fal.ai multi-model generation with provider-specific durations, aspect ratios, resolutions, prompt optimization, and native audio controls.',
  docsLink: 'https://docs.sim.ai/integrations/video_generator',
  category: 'blocks',
  integrationType: IntegrationType.AI,
  bgColor: '#181C1E',
  icon: VideoIcon,
  hideFromToolbar: false,
  subBlocks: withTypedModelFields(
    withDirectVideoCatalog(withFalVideoCatalog(VideoGeneratorV2Block.subBlocks))
  ),
  tools: {
    ...VideoGeneratorV2Block.tools,
    access: [...VideoGeneratorV2Block.tools.access, 'video_higgsfield'],
    config: {
      tool: (params) =>
        params.provider === 'higgsfield'
          ? 'video_higgsfield'
          : (VideoGeneratorV2Block.tools.config?.tool(params) ?? 'video_runway'),
      params: (params) => {
        if (params.provider === 'falai') {
          const falParams = VideoGeneratorV2Block.tools.config?.params?.(params) ?? params
          const model = getFalVideoModel(params.model)
          if (!model) return { ...falParams, visualReference: undefined }
          const withImage = Boolean(model.image && falParams.visualReference)
          return {
            ...keepFalSettingsAllowed(
              falParams,
              getFalVideoVariant(params.model, withImage),
              getFalVideoVariant(params.model, !withImage)
            ),
            visualReference: withImage ? falParams.visualReference : undefined,
          }
        }
        const visualReference =
          params.provider === 'runway'
            ? normalizeFileInput(params.visualReference, { single: true })
            : undefined
        const model = getDirectVideoModel(params.provider, params.model, Boolean(visualReference))
        const other = getDirectVideoModel(params.provider, params.model, !visualReference)?.settings
        const setting = (key: string, supported: unknown, fallbackKey?: string) => {
          if (!supported) return undefined
          const value = params[key] ?? (fallbackKey ? params[fallbackKey] : undefined)
          return value === FAL_MODEL_DEFAULT.id ? undefined : value
        }
        const duration = dropStaleSetting(
          setting('duration', model?.settings?.durations),
          model?.settings?.durations,
          other?.durations,
          true
        )
        return {
          provider: params.provider,
          model: params.model,
          apiKey: params.apiKey,
          prompt: params.prompt,
          visualReference,
          duration: duration ? Number(duration) : undefined,
          aspectRatio: dropStaleSetting(
            setting('aspectRatio', model?.settings?.aspectRatios),
            model?.settings?.aspectRatios,
            other?.aspectRatios
          ),
          resolution: dropStaleSetting(
            setting('resolution', model?.settings?.resolutions),
            model?.settings?.resolutions,
            other?.resolutions
          ),
          generateAudio: parseOptionalBooleanInput(
            setting('directGenerateAudio', model?.settings?.audio, 'generateAudio')
          ),
          promptOptimizer: parseOptionalBooleanInput(
            setting('promptOptimizer', model?.settings?.promptOptimizer)
          ),
          endpoint: params.provider === 'minimax' ? params.endpoint : undefined,
          cameraControl:
            model?.protocol === 'luma-legacy' && params.cameraControl
              ? typeof params.cameraControl === 'string'
                ? JSON.parse(params.cameraControl)
                : params.cameraControl
              : undefined,
        }
      },
    },
  },
  inputs: {
    ...VideoGeneratorV2Block.inputs,
    provider: {
      type: 'string',
      description: 'Video generation provider (runway, veo, luma, minimax, higgsfield, falai)',
    },
    duration: { type: 'number', description: 'Duration for the selected provider model' },
    aspectRatio: {
      type: 'string',
      description: 'Frame size or aspect ratio for the selected provider model',
    },
    resolution: { type: 'string', description: 'Resolution for the selected provider model' },
    directGenerateAudio: { type: 'boolean', description: 'Generate audio when supported' },
    promptOptimizer: {
      type: 'boolean',
      description: 'Enable prompt optimization when supported',
    },
    falDuration: {
      type: 'number',
      description: 'Duration in seconds for the selected fal endpoint',
    },
    falAspectRatio: { type: 'string', description: 'Aspect ratio for the selected fal endpoint' },
    falResolution: { type: 'string', description: 'Resolution for the selected fal endpoint' },
    falGenerateAudio: {
      type: 'boolean',
      description: 'Generate audio with the selected fal endpoint',
    },
    falPromptOptimizer: {
      type: 'boolean',
      description: 'Enable prompt optimization on the selected fal endpoint',
    },
  },
}
