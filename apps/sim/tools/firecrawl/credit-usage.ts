import type {
  FirecrawlCreditUsageParams,
  FirecrawlCreditUsageResponse,
} from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const creditUsageTool: ToolConfig<FirecrawlCreditUsageParams, FirecrawlCreditUsageResponse> =
  {
    id: 'firecrawl_credit_usage',
    name: 'Firecrawl Credit Usage',
    description: 'Retrieve the remaining and allocated Firecrawl credits for the team.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Firecrawl API key',
      },
    },

    request: {
      method: 'GET',
      url: 'https://api.firecrawl.dev/v2/team/credit-usage',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const usage = data.data ?? {}

      return {
        success: true,
        output: {
          remainingCredits: usage.remainingCredits ?? null,
          planCredits: usage.planCredits ?? null,
          billingPeriodStart: usage.billingPeriodStart ?? null,
          billingPeriodEnd: usage.billingPeriodEnd ?? null,
        },
      }
    },

    outputs: {
      remainingCredits: {
        type: 'number',
        description: 'Number of credits remaining for the team',
      },
      planCredits: {
        type: 'number',
        description: 'Credits allocated in the current plan',
        optional: true,
      },
      billingPeriodStart: {
        type: 'string',
        description: 'Start of the current billing period',
        optional: true,
      },
      billingPeriodEnd: {
        type: 'string',
        description: 'End of the current billing period',
        optional: true,
      },
    },
  }
