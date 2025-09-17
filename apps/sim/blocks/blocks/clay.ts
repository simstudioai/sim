import { ClayIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ClayPopulateResponse } from '@/tools/clay/types'

export const ClayBlock: BlockConfig<ClayPopulateResponse> = {
  type: 'clay',
  name: 'Clay',
  description: 'Populate Clay workbook',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Clay into the workflow. Can populate a table with data.',
  docsLink: 'https://docs.sim.ai/tools/clay',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ClayIcon,
  subBlocks: [
    {
      id: 'webhookURL',
      title: 'Webhook URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Clay webhook URL',
      required: true,
    },
    {
      id: 'data',
      title: 'Data (JSON or Plain Text)',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your JSON data to populate your Clay table',
      required: true,
      description: `JSON vs. Plain Text:
JSON: Best for populating multiple columns.
Plain Text: Best for populating a table in free-form style.
      `,
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Clay Auth token',
      password: true,
      connectionDroppable: false,
      required: true,
    },
  ],
  tools: {
    access: ['clay_populate'],
  },
  inputs: {
    authToken: { type: 'string', description: 'Clay authentication token' },
    webhookURL: { type: 'string', description: 'Clay webhook URL' },
    data: { type: 'json', description: 'Data to populate' },
  },
  outputs: {
    data: { type: 'json', description: 'Response data' },
  },
}
