import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from './types'

const logger = createLogger('WealthboxWriteContact')

// Utility function to safely convert to string and trim
const safeStringify = (value: any): string => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

// Utility function to validate parameters and build contact body
const validateAndBuildContactBody = (params: WealthboxWriteParams): Record<string, any> => {
  // Validate required fields with safe stringification
  const firstName = safeStringify(params.firstName).trim()
  const lastName = safeStringify(params.lastName).trim()

  if (!firstName) {
    throw new Error('First name is required')
  }
  if (!lastName) {
    throw new Error('Last name is required')
  }

  const body: Record<string, any> = {
    first_name: firstName,
    last_name: lastName,
  }

  // Add optional fields with safe stringification
  const emailAddress = safeStringify(params.emailAddress).trim()
  if (emailAddress) {
    body.email_addresses = [
      {
        address: emailAddress,
        kind: 'email',
        principal: true,
      },
    ]
  }

  const backgroundInformation = safeStringify(params.backgroundInformation).trim()
  if (backgroundInformation) {
    body.background_information = backgroundInformation
  }

  return body
}

export const wealthboxWriteContactTool: ToolConfig<WealthboxWriteParams, WealthboxWriteResponse> = {
  id: 'wealthbox_write_contact',
  name: 'Write Wealthbox Contact',
  description: 'Create a new Wealthbox contact',
  version: '1.1',
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
  directExecution: async (params: WealthboxWriteParams) => {
    // Validate access token
    if (!params.accessToken) {
      throw new Error('Access token is required')
    }

    const body = validateAndBuildContactBody(params)

    const response = await fetch('https://api.crmworkspace.com/v1/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Wealthbox contact write API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to create Wealthbox contact: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: true,
        output: {
          contact: undefined,
          metadata: {
            operation: 'write_contact' as const,
            itemType: 'contact' as const,
          },
        },
      }
    }

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
  transformResponse: async (response: Response, params?: WealthboxWriteParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Wealthbox contact write API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to create Wealthbox contact: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: true,
        output: {
          contact: undefined,
          metadata: {
            operation: 'write_contact' as const,
            itemType: 'contact' as const,
          },
        },
      }
    }

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
  transformError: (error) => {
    // If it's an Error instance with a message, use that
    if (error instanceof Error) {
      return error.message
    }

    // If it's an object with an error or message property
    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    // Default fallback message
    return 'An error occurred while creating Wealthbox contact'
  },
}
