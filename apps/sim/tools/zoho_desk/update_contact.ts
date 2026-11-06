import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import {
  buildZohoDeskBody,
  parseZohoDeskJson,
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskUpdateContactParams,
  ZohoDeskUpdateContactResponse,
} from '@/tools/zoho_desk/types'
import { ZOHO_DESK_CONTACT_PROPERTIES } from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskUpdateContactTool: ToolConfig<
  ZohoDeskUpdateContactParams,
  ZohoDeskUpdateContactResponse
> = {
  id: 'zoho_desk_update_contact',
  name: 'Zoho Desk Update Contact',
  description: 'Update Contact in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact ID',
    },
    contactLastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the contact',
    },
    contactAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account to which the contact is mapped',
    },
    contactFirstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the contact',
    },
    contactSecondaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Secondary email ID of the contact',
    },
    contactPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the contact',
    },
    contactMobile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mobile number of the contact',
    },
    contactOwnerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user who creates the contact',
    },
    contactType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact type',
    },
    contactEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email ID of the contact',
    },
    contactZip: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zip code',
    },
    contactCountry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's country of residence",
    },
    contactTwitter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Twitter ID of the contact',
    },
    contactCustomFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'User-defined fields related to the contact JSON object.',
    },
    contactCity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's city of residence",
    },
    contactStreet: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's address",
    },
    contactFacebook: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Facebook ID of the contact',
    },
    contactDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact description',
    },
    contactState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's state of residence",
    },
    contactTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact title',
    },
    contactLanguage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language preference to set for the Contact',
    },
  },
  request: {
    url: (params) => {
      return `${getZohoDeskApiBase(params)}/contacts/${safeUrlPathSegment(params.contactId, 'contactId')}`
    },
    method: 'PATCH',
    headers: buildZohoDeskHeaders,
    body: (params) => {
      const body = buildZohoDeskBody({
        lastName: params.contactLastName,
        accountId: params.contactAccountId,
        firstName: params.contactFirstName,
        secondaryEmail: params.contactSecondaryEmail,
        phone: params.contactPhone,
        mobile: params.contactMobile,
        ownerId: params.contactOwnerId,
        type: params.contactType,
        email: params.contactEmail,
        zip: params.contactZip,
        country: params.contactCountry,
        twitter: params.contactTwitter,
        cf: parseZohoDeskJson(params.contactCustomFields, 'contactCustomFields', 'object'),
        city: params.contactCity,
        street: params.contactStreet,
        facebook: params.contactFacebook,
        description: params.contactDescription,
        state: params.contactState,
        title: params.contactTitle,
        language: params.contactLanguage,
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
