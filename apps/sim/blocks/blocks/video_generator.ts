import { VideoIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType, type SubBlockConfig } from '@/blocks/types'
import { normalizeFileInput, parseOptionalBooleanInput } from '@/blocks/utils'
import type { VideoBlockResponse } from '@/tools/video/types'

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

const FALAI_LATEST_MODEL_OPTIONS = [
  { label: 'Google Veo 3.1', id: 'veo-3.1' },
  { label: 'Google Veo 3.1 Fast', id: 'veo-3.1-fast' },
  { label: 'OpenAI Sora 2', id: 'sora-2' },
  { label: 'OpenAI Sora 2 Pro', id: 'sora-2-pro' },
  { label: 'ByteDance Seedance 2.0', id: 'seedance-2.0' },
  { label: 'ByteDance Seedance 2.0 Fast', id: 'seedance-2.0-fast' },
  { label: 'Kling 3.0 Pro', id: 'kling-v3-pro' },
  { label: 'Kling 3.0 4K', id: 'kling-v3-4k' },
  { label: 'Kling O3 Pro', id: 'kling-o3-pro' },
  { label: 'Kling O3 4K', id: 'kling-o3-4k' },
  { label: 'MiniMax Hailuo 2.3 Pro', id: 'minimax-hailuo-2.3-pro' },
  { label: 'MiniMax Hailuo 2.3 Standard', id: 'minimax-hailuo-2.3-standard' },
  { label: 'WAN 2.2 A14B Turbo', id: 'wan-2.2-a14b-turbo' },
  { label: 'LTX 2.3', id: 'ltx-2.3' },
  { label: 'LTX 2.3 Fast', id: 'ltx-2.3-fast' },
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

const withFalAIModelOptions = (
  subBlocks: SubBlockConfig[],
  options: SubBlockConfig['options']
): SubBlockConfig[] =>
  subBlocks.map((subBlock) => {
    const condition = subBlock.condition
    if (
      subBlock.id === 'model' &&
      typeof condition === 'object' &&
      condition?.field === 'provider' &&
      condition.value === 'falai'
    ) {
      return { ...subBlock, options }
    }

    return subBlock
  })

export const VideoGeneratorBlock: BlockConfig<VideoBlockResponse> = {
  type: 'video_generator',
  name: 'Video Generator (Legacy)',
  description: 'Generate videos from text using AI',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate high-quality videos from text prompts using leading AI providers. Supports multiple models, aspect ratios, resolutions, and provider-specific features like world consistency, camera controls, and audio generation.',
  docsLink: 'https://docs.sim.ai/tools/video-generator',
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['video-generation', 'llm'],
  bgColor: '#181C1E',
  icon: VideoIcon,

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

export const VideoGeneratorV2Block: BlockConfig<VideoBlockResponse> = {
  ...VideoGeneratorBlock,
  type: 'video_generator_v2',
  name: 'Video Generator',
  hideFromToolbar: true,
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
      params: (params) => ({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        endpoint: params.endpoint,
        prompt: params.prompt,
        duration: params.duration ? Number(params.duration) : undefined,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        visualReference: normalizeFileInput(params.visualReference, { single: true }),
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
}

export const VideoGeneratorV3Block: BlockConfig<VideoBlockResponse> = {
  ...VideoGeneratorV2Block,
  type: 'video_generator_v3',
  name: 'Video Generator',
  description: 'Generate videos from text using AI',
  longDescription:
    'Generate high-quality videos from text prompts using leading AI providers. Supports Runway, Google Veo, Luma, MiniMax, and Fal.ai multi-model generation with provider-specific durations, aspect ratios, resolutions, prompt optimization, and native audio controls.',
  docsLink: 'https://docs.sim.ai/tools/video_generator',
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['video-generation', 'llm'],
  bgColor: '#181C1E',
  icon: VideoIcon,
  hideFromToolbar: false,
  subBlocks: withFalAIModelOptions(VideoGeneratorV2Block.subBlocks, FALAI_LATEST_MODEL_OPTIONS),
}
