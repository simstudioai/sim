import type { ToolConfig } from '@/tools/types'
import type { BoxSignListRequestsParams, BoxSignListResponse } from './types'
import { SIGN_REQUEST_LIST_OUTPUT_PROPERTIES } from './types'

export const boxSignListRequestsTool: ToolConfig<BoxSignListRequestsParams, BoxSignListResponse> = {
  id: 'box_sign_list_requests',
  name: 'Box Sign List Requests',
  description: 'List all Box Sign requests',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Box API',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of sign requests to return (max 1000)',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination marker from a previous response',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit !== undefined) queryParams.set('limit', String(params.limit))
      if (params.marker) queryParams.set('marker', params.marker)
      const qs = queryParams.toString()
      return `https://api.box.com/2.0/sign_requests${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Box Sign API error: ${response.status}`)
    }

    const entries = data.entries ?? []

    return {
      success: true,
      output: {
        signRequests: entries.map((req: Record<string, unknown>) => ({
          id: req.id ?? '',
          status: req.status ?? '',
          name: req.name ?? null,
          shortId: req.short_id ?? null,
          signers: ((req.signers as Array<Record<string, unknown>> | undefined) ?? []).map(
            (s: Record<string, unknown>) => ({
              email: s.email ?? null,
              role: s.role ?? null,
              hasViewedDocument: s.has_viewed_document ?? null,
              signerDecision: s.signer_decision ?? null,
              embedUrl: s.embed_url ?? null,
              order: s.order ?? null,
            })
          ),
          sourceFiles: ((req.source_files as Array<Record<string, unknown>> | undefined) ?? []).map(
            (f: Record<string, unknown>) => ({
              id: f.id ?? null,
              type: f.type ?? null,
              name: f.name ?? null,
            })
          ),
          emailSubject: req.email_subject ?? null,
          emailMessage: req.email_message ?? null,
          daysValid: req.days_valid ?? null,
          createdAt: req.created_at ?? null,
          autoExpireAt: req.auto_expire_at ?? null,
          prepareUrl: req.prepare_url ?? null,
          senderEmail: req.sender_email ?? null,
        })),
        count: entries.length,
        nextMarker: data.next_marker ?? null,
      },
    }
  },

  outputs: SIGN_REQUEST_LIST_OUTPUT_PROPERTIES,
}
