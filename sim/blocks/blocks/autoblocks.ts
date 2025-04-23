import { AutoblocksIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface AutoblocksResponse extends ToolResponse {
  output: {
    promptId: string
    version: string
    renderedPrompt: string
    templates: Record<string, string>
  }
}

export const AutoblocksBlock: BlockConfig<AutoblocksResponse> = {
  type: 'autoblocks',
  name: 'Autoblocks',
  description: 'Manage and use versioned prompts with Autoblocks',
  longDescription:
    'Collaborate on prompts with type safety, autocomplete, and backwards-incompatibility protection. Autoblocks prompt management allows product teams to collaborate while maintaining excellent developer experience.',
  category: 'tools',
  bgColor: '#0D2929',
  icon: AutoblocksIcon,
  subBlocks: [
    {
      id: 'promptId',
      title: 'Prompt ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the Autoblocks prompt ID',
    },
    {
      id: 'version',
      title: 'Version',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Latest Minor', id: 'latest' },
        { label: 'Specific Version', id: 'specific' },
      ],
      value: () => 'latest',
    },
    {
      id: 'specificVersion',
      title: 'Specific Version',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g. 1.2 or 1.latest',
      condition: {
        field: 'version',
        value: 'specific',
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Autoblocks API key',
      password: true,
    },
    {
      id: 'templateParams',
      title: 'Template Parameters',
      type: 'code',
      layout: 'full',
      language: 'json',
      placeholder: '{"param1": "value1", "param2": "value2"}',
    },
    {
      id: 'enableABTesting',
      title: 'Enable A/B Testing',
      type: 'switch',
      layout: 'half',
    },
    {
      id: 'abTestConfig',
      title: 'A/B Test Configuration',
      type: 'code',
      layout: 'full',
      language: 'json',
      placeholder:
        '{"versions": [{"version": "0", "weight": 95}, {"version": "latest", "weight": 5}]}',
      condition: {
        field: 'enableABTesting',
        value: true,
      },
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Production', id: 'production' },
        { label: 'Staging', id: 'staging' },
        { label: 'Development', id: 'development' },
      ],
      value: () => 'development',
    },
  ],
  tools: {
    access: ['autoblocks_prompt_manager'],
  },
  inputs: {
    promptId: { type: 'string', required: true },
    version: { type: 'string', required: true },
    specificVersion: { type: 'string', required: false },
    templateParams: { type: 'json', required: false },
    apiKey: { type: 'string', required: true },
    enableABTesting: { type: 'boolean', required: false },
    abTestConfig: { type: 'json', required: false },
    environment: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        promptId: 'string',
        version: 'string',
        renderedPrompt: 'string',
        templates: 'json',
      },
    },
  },
}
