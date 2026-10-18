import type { ToolConfig } from '@/tools/types'
import {
  buildZohoDeskBody,
  parseZohoDeskJson,
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskCreateContactParams,
  ZohoDeskCreateContactResponse,
} from '@/tools/zoho_desk/types'
import { ZOHO_DESK_CONTACT_PROPERTIES } from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskCreateContactTool: ToolConfig<
  ZohoDeskCreateContactParams,
  ZohoDeskCreateContactResponse
> = {
  id: 'zoho_desk_create_contact',
  name: 'Zoho Desk Create Contact',
  description: 'Create Contact in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Last name of the contact',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account to which the contact is mapped',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the contact',
    },
    secondaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Secondary email ID of the contact',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the contact',
    },
    mobile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mobile number of the contact',
    },
    ownerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user who creates the contact',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact type',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email ID of the contact',
    },
    zip: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Zip code' },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's country of residence",
    },
    twitter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Twitter ID of the contact',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'User-defined fields related to the contact JSON object.',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's city of residence",
    },
    street: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's address",
    },
    facebook: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Facebook ID of the contact',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact description',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's state of residence",
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact title',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language preference to set for the Contact',
    },
  },
  request: {
    url: (params) => {
      return `${getZohoDeskApiBase(params)}/contacts`
    },
    method: 'POST',
    headers: buildZohoDeskHeaders,
    body: (params) => {
      const body = buildZohoDeskBody({
        lastName: params.lastName,
        accountId: params.accountId,
        firstName: params.firstName,
        secondaryEmail: params.secondaryEmail,
        phone: params.phone,
        mobile: params.mobile,
        ownerId: params.ownerId,
        type: params.type,
        email: params.email,
        zip: params.zip,
        country: params.country,
        twitter: params.twitter,
        cf: parseZohoDeskJson(params.customFields, 'customFields', 'object'),
        city: params.city,
        street: params.street,
        facebook: params.facebook,
        description: params.description,
        state: params.state,
        title: params.title,
        language: params.language,
      })
      return body
    },
  },
  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { contact: projectZohoDeskResource(data, ZOHO_DESK_CONTACT_PROPERTIES) },
    }
  },
  outputs: {
    contact: {
      type: 'object',
      description: 'The contact',
      properties: ZOHO_DESK_CONTACT_PROPERTIES,
    },
  },
}
