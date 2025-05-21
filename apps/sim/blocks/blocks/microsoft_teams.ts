import { MicrosoftTeamsIcon } from '@/components/icons'
import {
  MicrosoftTeamsReadResponse,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import { BlockConfig } from '../types'

type MicrosoftTeamsResponse =
  | MicrosoftTeamsReadResponse
  | MicrosoftTeamsWriteResponse

export const MicrosoftTeamsBlock: BlockConfig<MicrosoftTeamsResponse> = {
  type: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Read, write, and create messages',
  longDescription:
    'Integrate Microsoft Teams functionality to manage messages. Read content from existing messages and write to messages using OAuth authentication. Supports text content manipulation for message creation and editing.',
  docsLink: 'https://docs.simstudio.ai/tools/microsoft_teams',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftTeamsIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Messages', id: 'read' },
        { label: 'Write to Message', id: 'write' },
      ],
    },
    // Microsoft Teams Credentials
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: ['https://graph.microsoft.com/.default'], //TODO: Modify scopes
      placeholder: 'Select Microsoft account',
    },
    {
        id: 'teamId',
        title: 'Select Team',
        type: 'file-selector',
        layout: 'full',
        provider: 'microsoft-teams',
        serviceId: 'microsoft-teams',
        requiredScopes: [],
        placeholder: 'Select a team',
        condition: { field: 'operation', value: ['write', 'read'] },
      },
    
    {
        id: 'chatId',
        title: 'Select Chat',   
        type: 'file-selector',
        layout: 'full',
        provider: 'microsoft-teams',
        serviceId: 'microsoft-teams',
        requiredScopes: [],
        placeholder: 'Select a chat',
        condition: { field: 'operation', value: ['write', 'read'] },
    },
    {
        id: 'channelId',
        title: 'Select Channel',
        type: 'file-selector',
        layout: 'full',
        provider: 'microsoft-teams',
        serviceId: 'microsoft-teams',
        requiredScopes: [],
        placeholder: 'Select a channel',
        condition: { field: 'operation', value: ['write', 'read'] },
    },
    // Create-specific Fields
    {
      id: 'content',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter message content',
      condition: { field: 'operation', value: 'write' },
    },
  ],
  tools: {
    access: ['microsoft_teams_read', 'microsoft_teams_write'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'microsoft_teams_read'
          case 'write':
            return 'microsoft_teams_write'
          default:
            throw new Error(`Invalid Microsoft Teams operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, messageId, ...rest } = params

        // Use the selected document ID or the manually entered one
        // If documentId is provided, it's from the file selector and contains the file ID
        // If not, fall back to manually entered ID
        const effectiveDocumentId = (messageId || '').trim()

        if (params.operation !== 'write' && !effectiveDocumentId) {
          throw new Error(
            'Message ID is required. Please select a message or enter an ID manually.'
          )
        }

        return {
          ...rest,
          messageId: effectiveDocumentId,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    messageId: { type: 'string', required: true },
    chatId: { type: 'string', required: false },
    channelId: { type: 'string', required: false },
    teamId: { type: 'string', required: true },
    content: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        metadata: 'json',
        updatedContent: 'boolean',
      },
    },
  },
}
