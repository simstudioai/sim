import type { ToolConfig } from '@/tools/types'
import type { BoxSignCancelRequestParams, BoxSignResponse } from './types'
import { SIGN_REQUEST_OUTPUT_PROPERTIES } from './types'

export const boxSignCancelRequestTool: ToolConfig<BoxSignCancelRequestParams, BoxSignResponse> = {
  id: 'box_sign_cancel_request',
  name: 'Box Sign Cancel Request',
  description: 'Cancel a pending Box Sign request',
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
    signRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the sign request to cancel',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/sign_requests/${params.signRequestId}/cancel`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Box Sign API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        status: data.status ?? '',
        name: data.name ?? null,
        shortId: data.short_id ?? null,
        signers: (data.signers ?? []).map((s: Record<string, unknown>) => ({
          email: s.email ?? null,
          role: s.role ?? null,
          hasViewedDocument: s.has_viewed_document ?? null,
          signerDecision: s.signer_decision ?? null,
          embedUrl: s.embed_url ?? null,
          order: s.order ?? null,
        })),
        sourceFiles: (data.source_files ?? []).map((f: Record<string, unknown>) => ({
          id: f.id ?? null,
          type: f.type ?? null,
          name: f.name ?? null,
        })),
        emailSubject: data.email_subject ?? null,
        emailMessage: data.email_message ?? null,
        daysValid: data.days_valid ?? null,
        createdAt: data.created_at ?? null,
        autoExpireAt: data.auto_expire_at ?? null,
        prepareUrl: data.prepare_url ?? null,
        senderEmail: data.sender_email ?? null,
      },
    }
  },

  outputs: SIGN_REQUEST_OUTPUT_PROPERTIES,
}
