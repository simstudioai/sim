import { QuiverIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { QuiverSvgResponse } from '@/tools/quiver/types'

export const QuiverBlock: BlockConfig<QuiverSvgResponse> = {
  type: 'quiver',
  name: 'Quiver',
  description: 'Generate and vectorize SVGs',
  longDescription:
    'Generate SVG images from text prompts or vectorize raster images into SVGs using QuiverAI. Supports reference images, style instructions, and multiple output generation.',
  docsLink: 'https://docs.sim.ai/tools/quiver',
  category: 'tools',
  integrationType: IntegrationType.Marketing,
  bgColor: '#000000',
  icon: QuiverIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Text to SVG', id: 'text_to_svg' },
        { label: 'Image to SVG', id: 'image_to_svg' },
        { label: 'List Models', id: 'list_models' },
      ],
      value: () => 'text_to_svg',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [{ label: 'Arrow Preview', id: 'arrow-preview' }],
      value: () => 'arrow-preview',
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Describe the SVG you want to generate...',
      required: { field: 'operation', value: 'text_to_svg' },
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'instructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Style or formatting guidance (optional)',
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'referenceFiles',
      title: 'Reference Images',
      type: 'file-upload',
      canonicalParamId: 'references',
      placeholder: 'Upload reference images (up to 4)',
      mode: 'basic',
      multiple: true,
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'referenceInput',
      title: 'Reference Images',
      type: 'short-input',
      canonicalParamId: 'references',
      placeholder: 'Reference files from previous blocks',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'n',
      title: 'Number of Outputs',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'imageFile',
      title: 'Image',
      type: 'file-upload',
      canonicalParamId: 'image',
      placeholder: 'Upload an image to vectorize',
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'image_to_svg' },
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'imageInput',
      title: 'Image',
      type: 'short-input',
      canonicalParamId: 'image',
      placeholder: 'Reference image from previous blocks',
      mode: 'advanced',
      required: { field: 'operation', value: 'image_to_svg' },
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'autoCrop',
      title: 'Auto Crop',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'targetSize',
      title: 'Target Size (px)',
      type: 'short-input',
      placeholder: '128-4096',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'topP',
      title: 'Top P',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'maxOutputTokens',
      title: 'Max Output Tokens',
      type: 'short-input',
      placeholder: '131072',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'presencePenalty',
      title: 'Presence Penalty',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your QuiverAI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['quiver_text_to_svg', 'quiver_image_to_svg', 'quiver_list_models'],
    config: {
      tool: (params: Record<string, string>) => `quiver_${params.operation}`,
      params: (params: Record<string, unknown>) => {
        const {
          references,
          image,
          topP,
          maxOutputTokens,
          presencePenalty,
          targetSize,
          autoCrop,
          ...rest
        } = params

        const normalizedRefs = normalizeFileInput(references)
        const normalizedImage = normalizeFileInput(image, { single: true })

        return {
          ...(rest as Record<string, unknown>),
          ...(normalizedRefs ? { references: normalizedRefs } : {}),
          ...(normalizedImage ? { image: normalizedImage } : {}),
          ...(rest.n ? { n: Number(rest.n) } : {}),
          ...(rest.temperature ? { temperature: Number(rest.temperature) } : {}),
          ...(topP ? { top_p: Number(topP) } : {}),
          ...(maxOutputTokens ? { max_output_tokens: Number(maxOutputTokens) } : {}),
          ...(presencePenalty ? { presence_penalty: Number(presencePenalty) } : {}),
          ...(targetSize ? { target_size: Number(targetSize) } : {}),
          ...(autoCrop === 'true' ? { auto_crop: true } : {}),
        }
      },
    },
  },
  inputs: {
    prompt: { type: 'string' },
    instructions: { type: 'string' },
    references: { type: 'file' },
    image: { type: 'file' },
  },
  outputs: {
    file: {
      type: 'file',
      description: 'First generated SVG file',
    },
    files: {
      type: 'json',
      description: 'All generated SVG files (when n > 1)',
    },
    svgContent: {
      type: 'string',
      description: 'Raw SVG markup content',
    },
    id: {
      type: 'string',
      description: 'Request ID',
    },
    usage: {
      type: 'json',
      description: 'Token usage statistics',
    },
    models: {
      type: 'json',
      description: 'List of available models (list_models operation only)',
    },
  },
}

export const QuiverBlockMeta = {
  tags: ['image-generation'],
  templates: [
    {
      icon: QuiverIcon,
      title: 'Quiver congressional trades watcher',
      prompt:
        'Build a scheduled workflow that monitors Quiver Quantitative for new congressional trades on tracked tickers, scores notability, and posts a Slack alert with the trade details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver insider signal aggregator',
      prompt:
        'Create a scheduled workflow that pulls Quiver insider trades and lobbying activity for tracked tickers, aggregates a signal score, and writes a research table for the portfolio review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver lobbying tracker',
      prompt:
        'Build a workflow that watches Quiver lobbying spend on tracked sectors, summarizes new filings, and emails a digest to portfolio managers weekly.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver patent watcher',
      prompt:
        'Create a scheduled workflow that monitors Quiver patent filings for tracked companies, scores relevance to thesis, and writes notable filings to a research log.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver government-contract alerter',
      prompt:
        'Build a workflow that watches Quiver for new government-contract awards on tracked tickers, posts a Slack alert with award size and agency, and writes the contract to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver Wallstreetbets pulse',
      prompt:
        'Create a scheduled daily workflow that pulls Quiver WallStreetBets mentions and sentiment for tracked tickers, captures spike events, and posts notable surges to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver corporate-flights watcher',
      prompt:
        'Build a scheduled workflow that monitors Quiver corporate jet flight data, flags unusual destination patterns for tracked tickers, and writes findings to a research file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
    },
  ],
} as const satisfies BlockMeta
