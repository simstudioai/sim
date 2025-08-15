import type { ToolConfig } from '@/tools/types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from '@/tools/wealthbox/types'
import { validateAndBuildContactBody } from '@/tools/wealthbox/utils'

export const wealthboxWriteContactTool: ToolConfig<WealthboxWriteParams, WealthboxWriteResponse> = {
  id: 'wealthbox_write_contact',
  name: 'Write Wealthbox Contact',
  description: 'Create a new Wealthbox contact',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
      visibility: 'hidden',
    },
    firstName: {
      type: 'string',
      required: true,
      description: 'The first name of the contact',
      visibility: 'user-or-llm',
    },
    lastName: {
      type: 'string',
      required: true,
      description: 'The last name of the contact',
      visibility: 'user-or-llm',
    },
    emailAddress: {
      type: 'string',
      required: false,
      description: 'The email address of the contact',
      visibility: 'user-or-llm',
    },
    backgroundInformation: {
      type: 'string',
      required: false,
      description: 'Background information about the contact',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: 'https://api.crmworkspace.com/v1/contacts',
    method: 'POST',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      return validateAndBuildContactBody(params)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Format contact information into readable content
    const contact = data
    let content = `Contact created: ${contact.first_name || ''} ${contact.last_name || ''}`.trim()

    if (contact.background_information) {
      content += `\nBackground: ${contact.background_information}`
    }

    if (contact.email_addresses && contact.email_addresses.length > 0) {
      content += '\nEmail Addresses:'
      contact.email_addresses.forEach((email: any) => {
        content += `\n  - ${email.address}${email.principal ? ' (Primary)' : ''} (${email.kind})`
      })
    }

    if (contact.phone_numbers && contact.phone_numbers.length > 0) {
      content += '\nPhone Numbers:'
      contact.phone_numbers.forEach((phone: any) => {
        content += `\n  - ${phone.address}${phone.extension ? ` ext. ${phone.extension}` : ''}${phone.principal ? ' (Primary)' : ''} (${phone.kind})`
      })
    }

    return {
      success: true,
      output: {
        content,
        contact,
        success: true,
        metadata: {
          operation: 'write_contact' as const,
          contactId: contact.id?.toString() || '',
          itemType: 'contact' as const,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created or updated contact data and metadata',
      properties: {
        contact: { type: 'object', description: 'Raw contact data from Wealthbox' },
        success: { type: 'boolean', description: 'Operation success indicator' },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            itemId: { type: 'string', description: 'ID of the created/updated contact' },
            itemType: { type: 'string', description: 'Type of item (contact)' },
          },
        },
      },
    },
  },
}
