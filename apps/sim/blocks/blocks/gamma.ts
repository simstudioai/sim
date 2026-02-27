import { GammaIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { GammaResponse } from '@/tools/gamma/types'

export const GammaBlock: BlockConfig<GammaResponse> = {
  type: 'gamma',
  name: 'Gamma',
  description: 'Generate presentations, documents, and webpages with AI',
  longDescription:
    'Integrate Gamma into the workflow. Can generate presentations, documents, webpages, and social posts from text, create from templates, check generation status, and browse themes and folders.',
  docsLink: 'https://docs.sim.ai/tools/gamma',
  category: 'tools',
  bgColor: '#002253',
  icon: GammaIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Generate', id: 'generate' },
        { label: 'Generate from Template', id: 'generate_from_template' },
        { label: 'Check Status', id: 'check_status' },
        { label: 'List Themes', id: 'list_themes' },
        { label: 'List Folders', id: 'list_folders' },
      ],
      value: () => 'generate',
    },
    // Generate operation inputs
    {
      id: 'inputText',
      title: 'Input Text',
      type: 'long-input',
      required: { field: 'operation', value: 'generate' },
      placeholder: 'Enter text content to generate from...',
      condition: { field: 'operation', value: 'generate' },
    },
    {
      id: 'textMode',
      title: 'Text Mode',
      type: 'dropdown',
      options: [
        { label: 'Generate', id: 'generate' },
        { label: 'Condense', id: 'condense' },
        { label: 'Preserve', id: 'preserve' },
      ],
      value: () => 'generate',
      condition: { field: 'operation', value: 'generate' },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'Presentation', id: 'presentation' },
        { label: 'Document', id: 'document' },
        { label: 'Webpage', id: 'webpage' },
        { label: 'Social', id: 'social' },
      ],
      value: () => 'presentation',
      condition: { field: 'operation', value: 'generate' },
    },
    {
      id: 'numCards',
      title: 'Number of Cards',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'additionalInstructions',
      title: 'Additional Instructions',
      type: 'long-input',
      placeholder: 'Any additional instructions for the generation...',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'textAmount',
      title: 'Text Amount',
      type: 'dropdown',
      options: [
        { label: 'Brief', id: 'brief' },
        { label: 'Medium', id: 'medium' },
        { label: 'Detailed', id: 'detailed' },
        { label: 'Extensive', id: 'extensive' },
      ],
      value: () => 'medium',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'textTone',
      title: 'Tone',
      type: 'short-input',
      placeholder: 'e.g., professional, casual, academic',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'textAudience',
      title: 'Audience',
      type: 'short-input',
      placeholder: 'e.g., executives, students, developers',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'textLanguage',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'cardSplit',
      title: 'Card Split',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Input Text Breaks', id: 'inputTextBreaks' },
      ],
      value: () => 'auto',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'cardDimensions',
      title: 'Card Dimensions',
      type: 'short-input',
      placeholder: 'e.g., 16x9, fluid, letter, a4',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate the correct card dimensions value for a Gamma generation.
Valid values depend on the format:
- Presentation: "fluid", "16x9", "4x3"
- Document: "fluid", "pageless", "letter", "a4"
- Social: "1x1", "4x5", "9x16"
Return ONLY the dimension value string, nothing else.`,
        placeholder: 'Describe the desired dimensions (e.g., "widescreen slides")...',
      },
    },
    {
      id: 'imageSource',
      title: 'Image Source',
      type: 'dropdown',
      options: [
        { label: 'AI Generated', id: 'aiGenerated' },
        { label: 'Pictographic', id: 'pictographic' },
        { label: 'Unsplash', id: 'unsplash' },
        { label: 'Web (All Images)', id: 'webAllImages' },
        { label: 'Web (Free to Use)', id: 'webFreeToUse' },
        { label: 'Web (Free Commercial)', id: 'webFreeToUseCommercially' },
        { label: 'Giphy', id: 'giphy' },
        { label: 'Placeholder', id: 'placeholder' },
        { label: 'No Images', id: 'noImages' },
      ],
      value: () => 'aiGenerated',
      condition: { field: 'operation', value: 'generate' },
      mode: 'advanced',
    },
    {
      id: 'imageModel',
      title: 'Image Model',
      type: 'short-input',
      placeholder: 'AI image model (when using AI Generated source)',
      condition: { field: 'operation', value: ['generate', 'generate_from_template'] },
      mode: 'advanced',
    },
    {
      id: 'imageStyle',
      title: 'Image Style',
      type: 'short-input',
      placeholder: 'e.g., watercolor, photorealistic, minimalist',
      condition: { field: 'operation', value: ['generate', 'generate_from_template'] },
      mode: 'advanced',
    },
    {
      id: 'exportAs',
      title: 'Export As',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'PDF', id: 'pdf' },
        { label: 'PPTX', id: 'pptx' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['generate', 'generate_from_template'] },
      mode: 'advanced',
    },
    {
      id: 'themeId',
      title: 'Theme ID',
      type: 'short-input',
      placeholder: 'Enter theme ID (use List Themes to find)',
      condition: { field: 'operation', value: ['generate', 'generate_from_template'] },
      mode: 'advanced',
    },
    {
      id: 'folderIds',
      title: 'Folder IDs',
      type: 'short-input',
      placeholder: 'Comma-separated folder IDs',
      condition: { field: 'operation', value: ['generate', 'generate_from_template'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Gamma folder IDs.
The user will describe which folders to store the generated gamma in.
Each folder ID is a string identifier from the Gamma workspace.
Use the List Folders operation to find available folder IDs first.
Return ONLY the comma-separated IDs, nothing else.
Example: "folder_abc123, folder_def456"`,
        placeholder: 'Describe which folders to store the gamma in...',
      },
    },
    // Generate from Template inputs
    {
      id: 'gammaId',
      title: 'Template Gamma ID',
      type: 'short-input',
      required: { field: 'operation', value: 'generate_from_template' },
      placeholder: 'Enter the template gamma ID',
      condition: { field: 'operation', value: 'generate_from_template' },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      required: { field: 'operation', value: 'generate_from_template' },
      placeholder: 'Instructions for adapting the template...',
      condition: { field: 'operation', value: 'generate_from_template' },
    },
    // Check Status inputs
    {
      id: 'generationId',
      title: 'Generation ID',
      type: 'short-input',
      required: { field: 'operation', value: 'check_status' },
      placeholder: 'Enter the generation ID to check',
      condition: { field: 'operation', value: 'check_status' },
    },
    // List Themes / List Folders inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter by name...',
      condition: { field: 'operation', value: ['list_themes', 'list_folders'] },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: ['list_themes', 'list_folders'] },
      mode: 'advanced',
    },
    {
      id: 'after',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from previous response',
      condition: { field: 'operation', value: ['list_themes', 'list_folders'] },
      mode: 'advanced',
    },
    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Gamma API key',
      password: true,
    },
  ],
  tools: {
    access: [
      'gamma_generate',
      'gamma_generate_from_template',
      'gamma_check_status',
      'gamma_list_themes',
      'gamma_list_folders',
    ],
    config: {
      tool: (params) => `gamma_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.numCards) result.numCards = Number(params.numCards)
        if (params.limit) result.limit = Number(params.limit)
        if (params.exportAs === '') result.exportAs = undefined
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Gamma API key' },
    inputText: { type: 'string', description: 'Text content for generation' },
    textMode: { type: 'string', description: 'Text handling mode' },
    format: { type: 'string', description: 'Output format' },
    numCards: { type: 'number', description: 'Number of cards to generate' },
    additionalInstructions: { type: 'string', description: 'Additional generation instructions' },
    textAmount: { type: 'string', description: 'Amount of text to generate' },
    textTone: { type: 'string', description: 'Tone of generated text' },
    textAudience: { type: 'string', description: 'Target audience' },
    textLanguage: { type: 'string', description: 'Language code' },
    cardSplit: { type: 'string', description: 'Card splitting strategy' },
    cardDimensions: { type: 'string', description: 'Card aspect ratio' },
    imageSource: { type: 'string', description: 'Image source for generation' },
    imageModel: { type: 'string', description: 'AI image model' },
    imageStyle: { type: 'string', description: 'Image style directive' },
    exportAs: { type: 'string', description: 'Export format' },
    themeId: { type: 'string', description: 'Theme ID' },
    folderIds: { type: 'string', description: 'Comma-separated folder IDs' },
    gammaId: { type: 'string', description: 'Template gamma ID' },
    prompt: { type: 'string', description: 'Template adaptation prompt' },
    generationId: { type: 'string', description: 'Generation ID to check' },
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Result limit' },
    after: { type: 'string', description: 'Pagination cursor' },
  },
  outputs: {
    generationId: { type: 'string', description: 'Generation job ID' },
    status: { type: 'string', description: 'Generation status' },
    gammaUrl: { type: 'string', description: 'URL of the generated gamma' },
    credits: { type: 'json', description: 'Credit usage (deducted, remaining)' },
    error: { type: 'json', description: 'Error details if generation failed' },
    themes: { type: 'json', description: 'List of themes' },
    folders: { type: 'json', description: 'List of folders' },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    nextCursor: { type: 'string', description: 'Pagination cursor for next page' },
  },
}
