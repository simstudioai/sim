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
        { label: 'Read Chat Messages', id: 'read_chat' },
        { label: 'Write Chat Message', id: 'write_chat' },
        { label: 'Read Channel Messages', id: 'read_channel' },
        { label: 'Write Channel Message', id: 'write_channel' },
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
      requiredScopes: [
        'openid',  
        'profile',          
        'email',   
        'User.Read',
        'Chat.Read',
        'Chat.ReadWrite',
        'ChannelMessage.Read.All',
        'ChannelMessage.ReadWrite',
        'Team.ReadBasic.All',
        'offline_access'
      ],
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
        condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
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
        condition: { field: 'operation', value: ['read_chat', 'write_chat'] },
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
        condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    // Create-specific Fields
    {
      id: 'content',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter message content',
      condition: { field: 'operation', value: ['write_chat', 'write_channel'] },
    },
  ],
  tools: {
    access: ['microsoft_teams_read_chat', 'microsoft_teams_write_chat', 'microsoft_teams_read_channel', 'microsoft_teams_write_channel'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read_chat':
            return 'microsoft_teams_read_chat'
          case 'write_chat':
            return 'microsoft_teams_write_chat'
          case 'read_channel':
            return 'microsoft_teams_read_channel'
          case 'write_channel':
            return 'microsoft_teams_write_channel'
          default:
            return 'microsoft_teams_read_chat'
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
    chatId: { type: 'string', required: true },
    channelId: { type: 'string', required: true },
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
