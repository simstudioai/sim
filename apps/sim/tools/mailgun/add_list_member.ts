import type { AddListMemberParams, AddListMemberResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunAddListMemberTool: ToolConfig<AddListMemberParams, AddListMemberResult> = {
  id: 'mailgun_add_list_member',
  name: 'Mailgun Add List Member',
  description: 'Add a member to a mailing list',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun API key',
    },
    listAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mailing list address (e.g., list@mg.example.com)',
    },
    address: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Member email address to add (e.g., user@example.com)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Member name',
    },
    vars: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON string of custom variables',
    },
    subscribed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the member is subscribed',
    },
  },

  request: {
    url: (params) => `https://api.mailgun.net/v3/lists/${params.listAddress}/members`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
    body: (params) => {
      const formData = new FormData()
      formData.append('address', params.address)

      if (params.name) {
        formData.append('name', params.name)
      }
      if (params.vars) {
        formData.append('vars', params.vars)
      }
      if (params.subscribed !== undefined) {
        formData.append('subscribed', params.subscribed ? 'yes' : 'no')
      }

      return { body: formData }
    },
  },

  transformResponse: async (response, params): Promise<AddListMemberResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to add list member')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        message: result.message,
        member: {
          address: result.member.address,
          name: result.member.name,
          subscribed: result.member.subscribed,
          vars: result.member.vars,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the member was added successfully' },
    message: { type: 'string', description: 'Response message' },
    member: { type: 'json', description: 'Added member details' },
  },
}
