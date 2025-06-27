import { ClayIcon } from '@/components/icons'
import type { ClayPopulateResponse } from '@/tools/clay/types'
import type { BlockConfig } from '../types'

export const ClayBlock: BlockConfig<ClayPopulateResponse> = {
  type: 'clay',
  name: 'Clay',
  description: 'Populate Clay workbook',
  longDescription:
    'Populate Clay workbook with data using a JSON or plain text. Enables direct communication and notifications with channel confirmation.',
  docsLink: 'https://docs.simstudio.ai/tools/clay',
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
      id: 'authToken',
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
    authToken: { type: 'string', required: true },
    webhookURL: { type: 'string', required: true },
    data: { type: 'json', required: true },
  },
  outputs: {
    data: 'any',
  },
}
