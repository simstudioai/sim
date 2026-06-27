import { VideoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const VideoGeneratorBlockDisplay = {
  type: 'video_generator',
  name: 'Video Generator (Legacy)',
  description: 'Generate videos from text using AI',
  category: 'blocks',
  bgColor: '#181C1E',
  icon: VideoIcon,
  longDescription:
    'Generate high-quality videos from text prompts using leading AI providers. Supports multiple models, aspect ratios, resolutions, and provider-specific features like world consistency, camera controls, and audio generation.',
  docsLink: 'https://docs.sim.ai/integrations/video-generator',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const VideoGeneratorV2BlockDisplay = {
  ...VideoGeneratorBlockDisplay,
  type: 'video_generator_v2',
  name: 'Video Generator',
  hideFromToolbar: true,
} satisfies BlockDisplay

export const VideoGeneratorV3BlockDisplay = {
  ...VideoGeneratorV2BlockDisplay,
  type: 'video_generator_v3',
  name: 'Video Generator',
  description: 'Generate videos from text using AI',
  category: 'blocks',
  bgColor: '#181C1E',
  icon: VideoIcon,
  longDescription:
    'Generate high-quality videos from text prompts using leading AI providers. Supports Runway, Google Veo, Luma, MiniMax, and Fal.ai multi-model generation with provider-specific durations, aspect ratios, resolutions, prompt optimization, and native audio controls.',
  docsLink: 'https://docs.sim.ai/integrations/video_generator',
  integrationType: IntegrationType.AI,
  hideFromToolbar: false,
} satisfies BlockDisplay
