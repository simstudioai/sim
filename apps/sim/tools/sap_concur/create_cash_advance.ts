import type { CreateCashAdvanceParams, SapConcurResponse } from '@/tools/sap_concur/types'
import { baseSapConcurInput, transformSapConcurResponse } from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const createCashAdvanceTool: InternalToolConfig<CreateCashAdvanceParams, SapConcurResponse> =
  {
    id: 'sap_concur_create_cash_advance',
    name: 'SAP Concur Create Cash Advance',
    description: 'Create a cash advance (POST /cashadvance/v4.1/cashadvances).',
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
          'Cash advance payload. Required fields: amountRequested ({ currency, amount }), name, and userId. Optional fields: accountCode, comment, purpose. The Concur docs are inconsistent on casing — the reference request example and the API Explorer swagger both use userId, while the schema table spells it userID; if a request is rejected with a 400, retry with the other spelling.',
      },
    },
    operation: {
      input: (params) => ({
        ...baseSapConcurInput(params),
        path: `/cashadvance/v4.1/cashadvances`,
        method: 'POST',
        body: params.body,
      }),
    },
    transformResponse: transformSapConcurResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description: 'Created cash advance payload',
        properties: {
          cashAdvanceId: {
            type: 'string',
            description: 'Unique identifier of the created cash advance',
            optional: true,
          },
        },
      },
    },
  }
