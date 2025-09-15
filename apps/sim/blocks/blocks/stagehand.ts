import { StagehandIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export interface StagehandExtractResponse extends ToolResponse {
  output: {
    data: Record<string, any>
  }
}

export const StagehandBlock: BlockConfig<StagehandExtractResponse> = {
  type: 'stagehand',
  name: 'Stagehand Extract',
  description: 'Extract data from websites',
  longDescription:
    'Integrate Stagehand into the workflow. Can extract structured data from webpages. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/stagehand',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the URL of the website to extract data from',
      required: true,
    },
    {
      id: 'instruction',
      title: 'Instructions',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter detailed instructions for what data to extract from the page...',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'OpenAI API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your OpenAI API key',
      password: true,
      required: true,
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter JSON Schema...',
      language: 'json',
      generationType: 'json-schema',
      required: true,
    },
  ],
  tools: {
    access: ['stagehand_extract'],
    config: {
      tool: () => 'stagehand_extract',
    },
  },
  inputs: {
    url: { type: 'string', description: 'Website URL to extract' },
    instruction: { type: 'string', description: 'Extraction instructions' },
    schema: { type: 'json', description: 'JSON schema definition' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
  },
  outputs: {
    data: { type: 'json', description: 'Extracted data' },
  },
}
