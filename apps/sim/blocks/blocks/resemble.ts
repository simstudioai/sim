import { ResembleIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { ResembleResponse } from '@/tools/resemble/types'

export const ResembleBlock: BlockConfig<ResembleResponse> = {
  type: 'resemble',
  name: 'Resemble',
  description: 'Deepfake detection, media intelligence, and watermarking',
  longDescription:
    'Integrate Resemble AI media safety into your workflow: detect deepfakes in audio/image/video, analyze media intelligence, and apply or detect invisible watermarks.',
  docsLink: 'https://docs.resemble.ai',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['deepfake-detection', 'media-safety'],
  bgColor: '#2E1AC4',
  icon: ResembleIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Deepfake Detection', id: 'resemble_detect' },
        { label: 'Media Intelligence', id: 'resemble_intelligence' },
        { label: 'Detect Watermark', id: 'resemble_watermark_detect' },
        { label: 'Apply Watermark', id: 'resemble_watermark_apply' },
      ],
      value: () => 'resemble_detect',
    },
    {
      id: 'url',
      title: 'Media URL',
      type: 'short-input',
      placeholder: 'https://example.com/media.mp4',
      required: true,
    },
    // Detection toggles
    { id: 'runIntelligence', title: 'Run Intelligence', type: 'switch', condition: { field: 'operation', value: 'resemble_detect' } },
    { id: 'audioSourceTracing', title: 'Audio Source Tracing', type: 'switch', condition: { field: 'operation', value: 'resemble_detect' } },
    { id: 'visualize', title: 'Visualize', type: 'switch', condition: { field: 'operation', value: 'resemble_detect' } },
    { id: 'useReverseSearch', title: 'Reverse Image Search', type: 'switch', condition: { field: 'operation', value: 'resemble_detect' } },
    { id: 'useOodDetector', title: 'OOD Detector', type: 'switch', condition: { field: 'operation', value: 'resemble_detect' } },
    { id: 'zeroRetentionMode', title: 'Zero-Retention Mode', type: 'switch', condition: { field: 'operation', value: 'resemble_detect' } },
    {
      id: 'modelTypes',
      title: 'Model Type',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Image', id: 'image' },
        { label: 'Talking Head', id: 'talking_head' },
      ],
      value: () => 'auto',
      condition: { field: 'operation', value: 'resemble_detect' },
    },
    // Intelligence options
    {
      id: 'mediaType',
      title: 'Media Type',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Audio', id: 'audio' },
        { label: 'Video', id: 'video' },
        { label: 'Image', id: 'image' },
      ],
      value: () => 'auto',
      condition: { field: 'operation', value: 'resemble_intelligence' },
    },
    // Apply-watermark options
    { id: 'strength', title: 'Strength (0–1)', type: 'short-input', placeholder: '0.2', condition: { field: 'operation', value: 'resemble_watermark_apply' } },
    { id: 'customMessage', title: 'Custom Message', type: 'short-input', placeholder: 'resembleai', condition: { field: 'operation', value: 'resemble_watermark_apply' } },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Resemble API key',
      required: true,
      password: true,
    },
  ],

  tools: {
    access: ['resemble_detect', 'resemble_intelligence', 'resemble_watermark_detect', 'resemble_watermark_apply'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'resemble_intelligence':
            return 'resemble_intelligence'
          case 'resemble_watermark_detect':
            return 'resemble_watermark_detect'
          case 'resemble_watermark_apply':
            return 'resemble_watermark_apply'
          default:
            return 'resemble_detect'
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Public HTTPS URL to the media' },
    runIntelligence: { type: 'boolean', description: 'Also run media intelligence' },
    audioSourceTracing: { type: 'boolean', description: 'Trace the source platform of fake audio' },
    visualize: { type: 'boolean', description: 'Generate heatmap artifacts' },
    useReverseSearch: { type: 'boolean', description: 'Image-only reverse image search' },
    useOodDetector: { type: 'boolean', description: 'Out-of-distribution detection' },
    zeroRetentionMode: { type: 'boolean', description: 'Auto-delete media after analysis' },
    modelTypes: { type: 'string', description: 'auto | image | talking_head' },
    mediaType: { type: 'string', description: 'auto | audio | video | image' },
    strength: { type: 'number', description: 'Watermark strength 0–1' },
    customMessage: { type: 'string', description: 'Watermark message' },
    apiKey: { type: 'string', description: 'Resemble API key' },
  },

  outputs: {
    result: { type: 'json', description: 'Result from the selected Resemble operation' },
  },
}
