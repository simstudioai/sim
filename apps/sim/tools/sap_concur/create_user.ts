import type { CreateUserParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  scimUserOutputProperties,
  transformSapConcurResponse,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const createUserTool: InternalToolConfig<CreateUserParams, SapConcurResponse> = {
  id: 'sap_concur_create_user',
  name: 'SAP Concur Create User',
  description: 'Create a new user identity (POST /profile/identity/v4.1/Users).',
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
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SCIM User payload. Required: schemas (include both "urn:ietf:params:scim:schemas:core:2.0:User" and "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"), userName, name.familyName, name.givenName, emails[].value, and companyId — which is required and immutable and must be set inside the "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" block, not at the top level. Optional: active, displayName, timezone, and other SCIM User attributes.',
    },
  },
  operation: {
    input: (params) => ({
      ...baseSapConcurInput(params),
      path: `/profile/identity/v4.1/Users`,
      method: 'POST',
      body: params.body,
    }),
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Created SCIM User payload',
      properties: scimUserOutputProperties,
    },
  },
}
