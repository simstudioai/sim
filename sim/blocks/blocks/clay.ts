import { ClayIcon } from '@/components/icons'
import { ClayPopulateResponse } from '@/tools/clay/types'
import { BlockConfig } from '../types'

export const ClayBlock: BlockConfig<ClayPopulateResponse> = {
  type: 'clay',
  name: 'Clay',
  description: 'Populate Clay with data',
  longDescription:
    'Populate Clay with data from a JSON file. Enables direct communication and notifications with timestamp tracking and channel confirmation.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ClayIcon,
  subBlocks: [
    {
      id: 'webhookId',
      title: 'Webhook ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Clay webhook ID',
    },
    {
      id: 'data',
      title: 'Data (JSON or Plain Text)',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your JSON data to populate your Clay table',
      description: `JSON vs. Plain Text:
JSON: Best for populating multiple columns.
Plain Text: Best for populating a table in free-form style.
      `,
    },
    {
      id: 'apiKey',
      title: 'Auth Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Clay Auth token',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['clay_populate'],
  },
  inputs: {
    apiKey: { type: 'string', required: false },
    webhookId: { type: 'string', required: true },
    data: { type: 'json', required: true },
  },
  outputs: {
    response: {
      type: {
        data: 'any',
      },
    },
  },
}
