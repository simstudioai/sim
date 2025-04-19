import { NotionIcon } from '@/components/icons'
import { NotionResponse } from '@/tools/notion/read'
import { BlockConfig } from '../types'

export const NotionBlock: BlockConfig<NotionResponse> = {
  type: 'notion',
  name: 'Notion',
  description: 'Read and write to Notion pages',
  longDescription:
    'Integrate with Notion to read content from pages or write new content programmatically. Access and modify your Notion workspace directly from your workflow using the official API.',
  category: 'tools',
  bgColor: '#000000',
  icon: NotionIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Page', id: 'read_notion' },
        { label: 'Write Page', id: 'write_notion' },
      ],
    },
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Notion page ID',
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter content to write (for write operation)',
      condition: { field: 'operation', value: 'write_notion' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Notion API key',
      password: true,
    },
  ],
  tools: {
    access: ['notion_read', 'notion_write'],
    config: {
      tool: (params) => {
        return params.operation === 'write_notion' ? 'notion_write' : 'notion_read'
      },
    },
  },
  inputs: {
    pageId: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    content: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        metadata: 'any',
      },
    },
  },
}
