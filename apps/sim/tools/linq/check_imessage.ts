import type { LinqCapabilityCheckParams, LinqCapabilityCheckResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqCheckImessageTool: ToolConfig<
  LinqCapabilityCheckParams,
  LinqCapabilityCheckResult
> = {
  id: 'linq_check_imessage',
  name: 'Check iMessage Capability',
  description: 'Check whether an address (phone number or email) supports iMessage',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    address: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number (E.164 format) or email address to check',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sender phone number to check from (defaults to an available number)',
    },
  },

  request: {
    url: `${LINQ_API_BASE}/capability/check_imessage`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { address: params.address }
      if (params.from) body.from = params.from
      return body
    },
  },

  transformResponse: async (response): Promise<LinqCapabilityCheckResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to check iMessage capability'),
        output: { address: '', available: false },
      }
    }

    return {
      success: true,
      output: {
        address: data.address ?? '',
        available: data.available ?? false,
      },
    }
  },

  outputs: {
    address: { type: 'string', description: 'The address that was checked' },
    available: { type: 'boolean', description: 'Whether the address supports iMessage' },
  },
}
