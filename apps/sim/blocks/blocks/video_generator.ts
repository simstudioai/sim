import { VideoIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { VideoBlockResponse } from '@/tools/video/types'

export const VideoGeneratorBlock: BlockConfig<VideoBlockResponse> = {
  type: 'video_generator',
  name: 'Video Generator',
  description: 'Generate videos from text using AI',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate high-quality videos from text prompts using leading AI providers. Supports multiple models, aspect ratios, resolutions, and provider-specific features like world consistency, camera controls, and audio generation.',
  docsLink: 'https://docs.sim.ai/tools/video-generator',
  category: 'tools',
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
      ],
      value: () => 'runway',
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
      required: false,
    },

    // MiniMax model and endpoint selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'minimax' },
      options: [{ label: 'Hailuo 2.3', id: 'hailuo-02' }],
      value: () => 'hailuo-02',
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
      required: false,
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
      required: false,
    },

    // Note: MiniMax resolution is fixed per endpoint (Pro=1080p, Standard=768p)

    // Runway-specific: Visual reference (REQUIRED for Gen-4)
    {
      id: 'visualReference',
      title: 'Reference Image',
      type: 'file-upload',
      condition: { field: 'provider', value: 'runway' },
      placeholder: 'Upload reference image',
      mode: 'basic',
      multiple: false,
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
      required: false,
    },

    // MiniMax-specific: Prompt optimizer
    {
      id: 'promptOptimizer',
      title: 'Prompt Optimizer',
      type: 'switch',
      condition: { field: 'provider', value: 'minimax' },
    },

    // API Key
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: ['video_runway', 'video_veo', 'video_luma', 'video_minimax'],
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
        promptOptimizer: params.promptOptimizer,
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
      description: 'Video generation provider (runway, veo, luma, minimax)',
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
      description: 'Aspect ratio (16:9, 9:16, 1:1) - not available for MiniMax',
    },
    resolution: {
      type: 'string',
      description: 'Video resolution - not available for MiniMax (fixed per endpoint)',
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
    cameraControl: {
      type: 'json',
      description: 'Camera controls for Luma (pan, zoom, tilt, truck, tracking)',
    },
  },

  outputs: {
    videoUrl: { type: 'string', description: 'Generated video URL' },
    videoFile: { type: 'json', description: 'Video file object with metadata' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    width: { type: 'number', description: 'Video width in pixels' },
    height: { type: 'number', description: 'Video height in pixels' },
    provider: { type: 'string', description: 'Provider used' },
    model: { type: 'string', description: 'Model used' },
  },
}
