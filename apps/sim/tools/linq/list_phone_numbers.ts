import type {
  LinqHealthStatus,
  LinqListPhoneNumbersParams,
  LinqListPhoneNumbersResult,
} from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqListPhoneNumbersTool: ToolConfig<
  LinqListPhoneNumbersParams,
  LinqListPhoneNumbersResult
> = {
  id: 'linq_list_phone_numbers',
  name: 'List Phone Numbers',
  description: 'List all phone numbers assigned to your partner account, with line health',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
  },

  request: {
    url: `${LINQ_API_BASE}/phone_numbers`,
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqListPhoneNumbersResult> => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to list phone numbers'),
        output: { phoneNumbers: [] },
      }
    }

    return {
      success: true,
      output: {
        phoneNumbers: (data?.phone_numbers ?? []).map((num: Record<string, unknown>) => ({
          id: (num.id as string) ?? '',
          phoneNumber: (num.phone_number as string) ?? '',
          forwardingNumber: (num.forwarding_number as string | null) ?? null,
          healthStatus:
            ((num.reputation ?? num.health_status) as LinqHealthStatus | undefined) ?? null,
        })),
      },
    }
  },

  outputs: {
    phoneNumbers: {
      type: 'array',
      description: 'Phone numbers assigned to the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Phone number ID' },
          phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
          forwardingNumber: {
            type: 'string',
            description: 'Forwarding number in E.164 format, or null',
          },
          healthStatus: {
            type: 'json',
            description: 'Line reputation/health status (status, doc_url)',
          },
        },
      },
    },
  },
}
