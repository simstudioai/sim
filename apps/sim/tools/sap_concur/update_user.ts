import type { SapConcurResponse, UpdateUserParams } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  scimUserOutputProperties,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const updateUserTool: InternalToolConfig<UpdateUserParams, SapConcurResponse> = {
  id: 'sap_concur_update_user',
  name: 'SAP Concur Update User',
  description: 'Patch a user identity (PATCH /profile/identity/v4.1/Users/{id}).',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    userUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User UUID to update',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SCIM PATCH payload. Required: schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"] and Operations, an array of { op, path, value } where op is add, replace, or remove. If the target location is a multi-valued attribute and no filter is specified, the attribute and all values are replaced. Example: deactivate a user with { op: "replace", path: "active", value: false }.',
    },
  },
  operation: {
    input: (params) => {
      const userUuid = trimRequired(params.userUuid, 'userUuid')
      return {
        ...baseSapConcurInput(params),
        path: `/profile/identity/v4.1/Users/${encodeURIComponent(userUuid)}`,
        method: 'PATCH',
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Updated SCIM User payload',
      properties: scimUserOutputProperties,
    },
  },
}
