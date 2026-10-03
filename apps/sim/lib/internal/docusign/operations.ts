import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { DocuSignClient, MAX_DOCUSIGN_DOCUMENT_BYTES } from '@/lib/internal/docusign/client'
import { DocuSignOperationError } from '@/lib/internal/docusign/errors'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type {
  DocuSignCreateFromTemplateParams,
  DocuSignDownloadDocumentParams,
  DocuSignGetEnvelopeParams,
  DocuSignListEnvelopesParams,
  DocuSignListRecipientsParams,
  DocuSignListTemplatesParams,
  DocuSignSendEnvelopeParams,
  DocuSignVoidEnvelopeParams,
} from '@/tools/docusign/types'

const logger = createLogger('DocuSignOperations')
const MAX_LEGACY_INLINE_DOCUMENT_BYTES = 7 * 1024 * 1024

export interface DocuSignOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

function jsonBody(data: Record<string, unknown>): RequestInit {
  return { method: 'POST', body: JSON.stringify(data) }
}

async function client(accessToken: string, signal?: AbortSignal): Promise<DocuSignClient> {
  return DocuSignClient.create(accessToken, signal)
}

export async function executeDocuSignCreateFromTemplate(
  input: DocuSignCreateFromTemplateParams,
  context: DocuSignOperationContext
) {
  let templateRoles: unknown[] = []
  if (input.templateRoles) {
    try {
      const parsed: unknown = JSON.parse(input.templateRoles)
      templateRoles = Array.isArray(parsed) ? parsed : []
    } catch {
      throw new DocuSignOperationError('Invalid JSON for templateRoles', 400)
    }
  }
  const body: Record<string, unknown> = {
    templateId: input.templateId,
    status: input.status || 'sent',
    templateRoles,
  }
  if (input.emailSubject) body.emailSubject = input.emailSubject
  if (input.emailBody) body.emailBlurb = input.emailBody
  const provider = await client(input.accessToken, context.signal)
  return provider.json(
    '/envelopes',
    jsonBody(body),
    'DocuSign create from template response',
    'Failed to create envelope from template',
    context.signal
  )
}

export async function executeDocuSignSendEnvelope(
  input: DocuSignSendEnvelopeParams,
  context: DocuSignOperationContext
) {
  let documentBase64 = ''
  let documentName = 'document.pdf'
  if (input.file) {
    try {
      const parsed = FileInputSchema.parse(input.file)
      const files = processFilesToUserFiles([parsed as RawFileInput], context.requestId, logger)
      const file = files[0]
      if (file) {
        const denied = await assertToolFileAccess(
          file.key,
          context.userId,
          context.requestId,
          logger
        )
        if (denied) throw new DocuSignOperationError('File not found', denied.status)
        if (file.size > MAX_DOCUSIGN_DOCUMENT_BYTES) {
          throw new DocuSignOperationError('Document is too large to send through DocuSign', 413)
        }
        const { buffer } = await downloadServableFileFromStorage(file, context.requestId, logger, {
          maxBytes: MAX_DOCUSIGN_DOCUMENT_BYTES,
          signal: context.signal,
        })
        assertKnownSizeWithinLimit(buffer.length, MAX_DOCUSIGN_DOCUMENT_BYTES, 'DocuSign document')
        documentBase64 = buffer.toString('base64')
        documentName = file.name
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (error instanceof DocuSignOperationError) throw error
      if (isDocNotReadyError(error)) {
        throw new DocuSignOperationError(docNotReadyMessage(), 409)
      }
      if (isPayloadSizeLimitError(error)) {
        throw new DocuSignOperationError(
          getErrorMessage(error, 'Document is too large to send through DocuSign'),
          413
        )
      }
      throw new DocuSignOperationError('Failed to process uploaded file', 400)
    }
  }

  const status = input.status || 'sent'
  if (!documentBase64 && status === 'sent') {
    throw new DocuSignOperationError('A document file is required to send an envelope', 400)
  }
  const envelope: Record<string, unknown> = {
    emailSubject: input.emailSubject,
    status,
    recipients: {
      signers: [
        {
          email: input.signerEmail,
          name: input.signerName,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [
              {
                anchorString: '/sig1/',
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                anchorYOffset: '0',
              },
            ],
            dateSignedTabs: [
              {
                anchorString: '/date1/',
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                anchorYOffset: '0',
              },
            ],
          },
        },
      ],
      carbonCopies: input.ccEmail
        ? [
            {
              email: input.ccEmail,
              name: input.ccName || input.ccEmail,
              recipientId: '2',
              routingOrder: '2',
            },
          ]
        : [],
    },
  }
  if (input.emailBody) envelope.emailBlurb = input.emailBody
  if (documentBase64) {
    envelope.documents = [
      {
        documentBase64,
        name: documentName,
        fileExtension: documentName.split('.').pop() || 'pdf',
        documentId: '1',
      },
    ]
  }
  const provider = await client(input.accessToken, context.signal)
  return provider.json(
    '/envelopes',
    jsonBody(envelope),
    'DocuSign send envelope response',
    'Failed to send envelope',
    context.signal
  )
}

export async function executeDocuSignGetEnvelope(
  input: DocuSignGetEnvelopeParams,
  context: DocuSignOperationContext
) {
  const provider = await client(input.accessToken, context.signal)
  return provider.json(
    `/envelopes/${input.envelopeId.trim()}?include=recipients,documents`,
    {},
    'DocuSign envelope response',
    'Failed to get envelope',
    context.signal
  )
}

export async function executeDocuSignListEnvelopes(
  input: DocuSignListEnvelopesParams,
  context: DocuSignOperationContext
) {
  const query = new URLSearchParams()
  if (input.fromDate) query.append('from_date', input.fromDate)
  else {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    query.append('from_date', thirtyDaysAgo.toISOString())
  }
  if (input.toDate) query.append('to_date', input.toDate)
  if (input.envelopeStatus) query.append('status', input.envelopeStatus)
  if (input.searchText) query.append('search_text', input.searchText)
  if (input.count) query.append('count', input.count)
  const provider = await client(input.accessToken, context.signal)
  return provider.json(
    `/envelopes?${query}`,
    {},
    'DocuSign envelope list response',
    'Failed to list envelopes',
    context.signal
  )
}

export async function executeDocuSignVoidEnvelope(
  input: DocuSignVoidEnvelopeParams,
  context: DocuSignOperationContext
) {
  const provider = await client(input.accessToken, context.signal)
  await provider.json(
    `/envelopes/${input.envelopeId.trim()}`,
    { method: 'PUT', body: JSON.stringify({ status: 'voided', voidedReason: input.voidedReason }) },
    'DocuSign void envelope response',
    'Failed to void envelope',
    context.signal
  )
  return { envelopeId: input.envelopeId, status: 'voided' as const }
}

export async function executeDocuSignDownloadDocument(
  input: DocuSignDownloadDocumentParams,
  context: DocuSignOperationContext
) {
  const documentId = input.documentId || 'combined'
  const provider = await client(input.accessToken, context.signal)
  const { buffer, contentType, fileName } = await provider.document(
    input.envelopeId.trim(),
    documentId,
    context.signal
  )
  context.signal?.throwIfAborted()
  const legacy =
    buffer.length <= MAX_LEGACY_INLINE_DOCUMENT_BYTES
      ? { base64Content: buffer.toString('base64') }
      : {}
  const file =
    context.workspaceId && context.workflowId && context.executionId
      ? await uploadExecutionFile(
          {
            workspaceId: context.workspaceId,
            workflowId: context.workflowId,
            executionId: context.executionId,
          },
          buffer,
          fileName,
          contentType,
          context.userId
        )
      : await uploadCopilotFile({ buffer, fileName, contentType, userId: context.userId })
  return { file, mimeType: contentType, fileName, ...legacy }
}

export async function executeDocuSignListTemplates(
  input: DocuSignListTemplatesParams,
  context: DocuSignOperationContext
) {
  const query = new URLSearchParams()
  if (input.searchText) query.append('search_text', input.searchText)
  if (input.count) query.append('count', input.count)
  const suffix = query.size ? `?${query}` : ''
  const provider = await client(input.accessToken, context.signal)
  return provider.json(
    `/templates${suffix}`,
    {},
    'DocuSign template list response',
    'Failed to list templates',
    context.signal
  )
}

export async function executeDocuSignListRecipients(
  input: DocuSignListRecipientsParams,
  context: DocuSignOperationContext
) {
  const provider = await client(input.accessToken, context.signal)
  return provider.json(
    `/envelopes/${input.envelopeId.trim()}/recipients`,
    {},
    'DocuSign recipients response',
    'Failed to list recipients',
    context.signal
  )
}
