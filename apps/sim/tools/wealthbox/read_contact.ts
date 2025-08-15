import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { WealthboxReadParams, WealthboxReadResponse } from '@/tools/wealthbox/types'

const logger = createLogger('WealthboxReadContact')

export const wealthboxReadContactTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_contact',
  name: 'Read Wealthbox Contact',
  description: 'Read content from a Wealthbox contact',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Wealthbox API',
    },
    contactId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The ID of the contact to read',
    },
  },

  request: {
    url: (params) => {
      const contactId = params.contactId?.trim()
      let url = 'https://api.crmworkspace.com/v1/contacts'
      if (contactId) {
        url = `https://api.crmworkspace.com/v1/contacts/${contactId}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: WealthboxReadParams) => {
    const data = await response.json()

    // Format contact information into readable content
    const contact = data
    let content = `Contact: ${contact.first_name || ''} ${contact.last_name || ''}`.trim()

    if (contact.company_name) {
      content += `\nCompany: ${contact.company_name}`
    }

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
        metadata: {
          operation: 'read_contact' as const,
          contactId: params?.contactId || contact.id?.toString() || '',
          itemType: 'contact' as const,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Contact data and metadata',
      properties: {
        content: { type: 'string', description: 'Formatted contact information' },
        contact: { type: 'object', description: 'Raw contact data from Wealthbox' },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            contactId: { type: 'string', description: 'ID of the contact' },
            itemType: { type: 'string', description: 'Type of item (contact)' },
          },
        },
      },
    },
  },
}
