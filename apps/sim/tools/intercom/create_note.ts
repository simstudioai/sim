import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomCreateNoteParams {
  accessToken: string
  contactId: string
  body: string
  admin_id?: string
}

export interface IntercomCreateNoteV2Response {
  success: boolean
  output: {
    id: string
    body: string
    created_at: number
    type: string
    author: any | null
    contact: any | null
  }
}

const createNoteBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the contact to add the note to',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content of the note',
    },
    admin_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the admin creating the note',
    },
  },

  request: {
    url: (params: IntercomCreateNoteParams) =>
      buildIntercomUrl(`/contacts/${params.contactId}/notes`),
    method: 'POST',
    headers: (params: IntercomCreateNoteParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomCreateNoteParams) => {
      const payload: any = {
        body: params.body,
      }

      if (params.admin_id) {
        payload.admin_id = params.admin_id
      }

      return payload
    },
  },
} satisfies Pick<ToolConfig<IntercomCreateNoteParams, any>, 'params' | 'request'>

export const intercomCreateNoteV2Tool: ToolConfig<
  IntercomCreateNoteParams,
  IntercomCreateNoteV2Response
> = {
  ...createNoteBase,
  id: 'intercom_create_note_v2',
  name: 'Create Note in Intercom',
  description: 'Add a note to a specific contact',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'create_note')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        body: data.body,
        created_at: data.created_at,
        type: data.type ?? 'note',
        author: data.author ?? null,
        contact: data.contact ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique identifier for the note' },
    body: { type: 'string', description: 'The text content of the note' },
    created_at: { type: 'number', description: 'Unix timestamp when the note was created' },
    type: { type: 'string', description: 'Object type (note)' },
    author: {
      type: 'object',
      description: 'The admin who created the note',
      optional: true,
      properties: {
        type: { type: 'string', description: 'Author type (admin)' },
        id: { type: 'string', description: 'Author ID' },
        name: { type: 'string', description: 'Author name' },
        email: { type: 'string', description: 'Author email' },
      },
    },
    contact: {
      type: 'object',
      description: 'The contact the note was created for',
      optional: true,
      properties: {
        type: { type: 'string', description: 'Contact type' },
        id: { type: 'string', description: 'Contact ID' },
      },
    },
  },
}
