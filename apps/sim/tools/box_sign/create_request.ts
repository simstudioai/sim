import type { ToolConfig } from '@/tools/types'
import type { BoxSignCreateRequestParams, BoxSignResponse } from './types'
import { SIGN_REQUEST_OUTPUT_PROPERTIES } from './types'

export const boxSignCreateRequestTool: ToolConfig<BoxSignCreateRequestParams, BoxSignResponse> = {
  id: 'box_sign_create_request',
  name: 'Box Sign Create Request',
  description: 'Create a new Box Sign request to send documents for e-signature',
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
    sourceFileIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated Box file IDs to send for signing',
    },
    signerEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Primary signer email address',
    },
    signerRole: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary signer role: signer, approver, or final_copy_reader (default: signer)',
    },
    additionalSigners: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of additional signers, e.g. [{"email":"user@example.com","role":"signer"}]',
    },
    parentFolderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Box folder ID where signed documents will be stored (default: user root)',
    },
    emailSubject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom subject line for the signing email',
    },
    emailMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom message in the signing email body',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the sign request',
    },
    daysValid: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days before the request expires (0-730)',
    },
    areRemindersEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send automatic signing reminders',
    },
    areTextSignaturesEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to allow typed (text) signatures',
    },
    signatureColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Signature color: blue, black, or red',
    },
    redirectUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to redirect signers to after signing',
    },
    declinedRedirectUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to redirect signers to after declining',
    },
    isDocumentPreparationNeeded: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether document preparation is needed before sending',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system reference ID',
    },
  },

  request: {
    url: 'https://api.box.com/2.0/sign_requests',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const fileIds = params.sourceFileIds
        .split(',')
        .map((id: string) => id.trim())
        .filter(Boolean)
      const sourceFiles = fileIds.map((id: string) => ({ type: 'file', id }))

      const signers: Array<Record<string, unknown>> = [
        {
          email: params.signerEmail,
          role: params.signerRole || 'signer',
        },
      ]

      if (params.additionalSigners) {
        try {
          const additional =
            typeof params.additionalSigners === 'string'
              ? JSON.parse(params.additionalSigners)
              : params.additionalSigners
          if (Array.isArray(additional)) {
            signers.push(...additional)
          }
        } catch {
          throw new Error(
            'Invalid JSON in additionalSigners. Expected a JSON array of signer objects.'
          )
        }
      }

      const body: Record<string, unknown> = {
        source_files: sourceFiles,
        signers,
      }

      if (params.parentFolderId) {
        body.parent_folder = { type: 'folder', id: params.parentFolderId }
      }
      if (params.emailSubject) body.email_subject = params.emailSubject
      if (params.emailMessage) body.email_message = params.emailMessage
      if (params.name) body.name = params.name
      if (params.daysValid !== undefined) body.days_valid = params.daysValid
      if (params.areRemindersEnabled !== undefined)
        body.are_reminders_enabled = params.areRemindersEnabled
      if (params.areTextSignaturesEnabled !== undefined)
        body.are_text_signatures_enabled = params.areTextSignaturesEnabled
      if (params.signatureColor) body.signature_color = params.signatureColor
      if (params.redirectUrl) body.redirect_url = params.redirectUrl
      if (params.declinedRedirectUrl) body.declined_redirect_url = params.declinedRedirectUrl
      if (params.isDocumentPreparationNeeded !== undefined)
        body.is_document_preparation_needed = params.isDocumentPreparationNeeded
      if (params.externalId) body.external_id = params.externalId

      return body
    },
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
