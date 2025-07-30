import { JinaAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ReadUrlResponse } from '@/tools/jina/types'

export const JinaBlock: BlockConfig<ReadUrlResponse> = {
  type: 'jina',
  name: 'Jina',
  description: 'Convert website content into text',
  longDescription:
    "Transform web content into clean, readable text using Jina AI's advanced extraction capabilities. Extract meaningful content from websites while preserving important information and optionally gathering links.",
  docsLink: 'https://docs.sim.ai/tools/jina',
  category: 'tools',
  bgColor: '#333333',
  icon: JinaAIIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter URL to extract content from',
    },
    {
      id: 'options',
      title: 'Options',
      type: 'checkbox-list',
      layout: 'full',
      options: [
        { label: 'Use Reader LM v2', id: 'useReaderLMv2' },
        { label: 'Gather Links', id: 'gatherLinks' },
        { label: 'JSON Response', id: 'jsonResponse' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter your Jina API key',
      password: true,
    },
  ],
  tools: {
    access: ['jina_read_url'],
  },
  inputs: {
    url: { type: 'string', description: 'URL to extract' },
    useReaderLMv2: { type: 'boolean', description: 'Use Reader LM v2' },
    gatherLinks: { type: 'boolean', description: 'Gather page links' },
    jsonResponse: { type: 'boolean', description: 'JSON response format' },
    apiKey: { type: 'string', description: 'Jina API key' },
  },
  outputs: {
    content: { type: 'string', description: 'Extracted content' },
  },
}
