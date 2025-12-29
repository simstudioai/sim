import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'
import type { CreateLinkTokenParams, LinkTokenResponse } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Plaid Create Link Token Tool
 * Uses official plaid SDK for Link token creation
 */
export const plaidCreateLinkTokenTool: ToolConfig<CreateLinkTokenParams, LinkTokenResponse> = {
  id: 'plaid_create_link_token',
  name: 'Plaid Create Link Token',
  description: 'Create a Link token for initializing Plaid Link UI',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Plaid client ID',
    },
    secret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Plaid secret key',
    },
    clientName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Client application name displayed in Plaid Link',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code (e.g., "en", "es", "fr"). Defaults to "en".',
    },
    countryCodes: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of country codes (e.g., ["US", "CA"])',
    },
    products: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of products to use (e.g., ["transactions", "auth", "identity"])',
    },
    user: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'User object with client_user_id (required) and optional email/phone',
    },
    redirectUri: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OAuth redirect URI for OAuth institutions',
    },
    webhook: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Webhook URL for receiving notifications',
    },
    accountFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters for account selection',
    },
  },

  /**
   * SDK-based execution using plaid PlaidApi
   * Creates Plaid Link token for user authentication flow
   */
  directExecution: async (params) => {
    try {
      // Initialize Plaid SDK client
      const configuration = new Configuration({
        basePath: PlaidEnvironments.production,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': params.clientId,
            'PLAID-SECRET': params.secret,
          },
        },
      })

      const plaidClient = new PlaidApi(configuration)

      // Prepare request
      const request: any = {
        client_name: params.clientName,
        language: params.language || 'en',
        country_codes: params.countryCodes as CountryCode[],
        products: params.products as Products[],
        user: params.user,
      }

      if (params.redirectUri) request.redirect_uri = params.redirectUri
      if (params.webhook) request.webhook = params.webhook
      if (params.accountFilters) request.account_filters = params.accountFilters

      // Create link token using SDK
      const response = await plaidClient.linkTokenCreate(request)
      const data = response.data

      return {
        success: true,
        output: {
          linkToken: {
            link_token: data.link_token,
            expiration: data.expiration,
            request_id: data.request_id,
          },
          metadata: {
            expiration: data.expiration,
            created: true,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `PLAID_LINK_TOKEN_ERROR: Failed to create Plaid link token - ${errorDetails}`,
      }
    }
  },

  outputs: {
    linkToken: {
      type: 'json',
      description: 'The created Plaid link token object',
    },
    metadata: {
      type: 'json',
      description: 'Link token metadata',
    },
  },
}
