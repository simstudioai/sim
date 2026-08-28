import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { DocuSignOperationError } from '@/lib/internal/docusign/errors'
import {
  type DocuSignOperationContext,
  executeDocuSignCreateFromTemplate,
  executeDocuSignDownloadDocument,
  executeDocuSignGetEnvelope,
  executeDocuSignListEnvelopes,
  executeDocuSignListRecipients,
  executeDocuSignListTemplates,
  executeDocuSignSendEnvelope,
  executeDocuSignVoidEnvelope,
} from '@/lib/internal/docusign/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const auth = { accessToken: z.string().min(1, 'Access token is required') }
const schemas = {
  docusign_create_from_template: z.object({
    ...auth,
    templateId: z.string().min(1),
    emailSubject: z.string().optional(),
    emailBody: z.string().optional(),
    templateRoles: z.string().optional().default(''),
    status: z.string().optional(),
  }),
  docusign_download_document: z.object({
    ...auth,
    envelopeId: z.string().min(1),
    documentId: z.string().optional(),
  }),
  docusign_get_envelope: z.object({ ...auth, envelopeId: z.string().min(1) }),
  docusign_list_envelopes: z.object({
    ...auth,
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    envelopeStatus: z.string().optional(),
    searchText: z.string().optional(),
    count: z.string().optional(),
  }),
  docusign_list_recipients: z.object({ ...auth, envelopeId: z.string().min(1) }),
  docusign_list_templates: z.object({
    ...auth,
    searchText: z.string().optional(),
    count: z.string().optional(),
  }),
  docusign_send_envelope: z.object({
    ...auth,
    emailSubject: z.string().min(1),
    emailBody: z.string().optional(),
    signerEmail: z.string().min(1),
    signerName: z.string().min(1),
    ccEmail: z.string().optional(),
    ccName: z.string().optional(),
    file: z.unknown().optional(),
    status: z.string().optional(),
  }),
  docusign_void_envelope: z.object({
    ...auth,
    envelopeId: z.string().min(1),
    voidedReason: z.string().min(1),
  }),
} as const

type DocuSignToolId = keyof typeof schemas

function isDocuSignToolId(value: string): value is DocuSignToolId {
  return Object.hasOwn(schemas, value)
}

function requiredInputError(toolId: DocuSignToolId, input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (toolId === 'docusign_send_envelope') {
    if (!value.signerEmail || !value.signerName || !value.emailSubject) {
      return 'signerEmail, signerName, and emailSubject are required'
    }
  }
  if (toolId === 'docusign_create_from_template' && !value.templateId) {
    return 'templateId is required'
  }
  if (
    (toolId === 'docusign_download_document' ||
      toolId === 'docusign_get_envelope' ||
      toolId === 'docusign_list_recipients' ||
      toolId === 'docusign_void_envelope') &&
    !value.envelopeId
  ) {
    return 'envelopeId is required'
  }
  if (toolId === 'docusign_void_envelope' && !value.voidedReason) {
    return 'voidedReason is required'
  }
  return undefined
}

async function executeOperation<I>(
  schema: z.ZodType<I>,
  request: InternalToolOperationCall,
  execute: (input: I, context: DocuSignOperationContext) => Promise<unknown>
): Promise<Response> {
  request.signal?.throwIfAborted()
  const requiredError = requiredInputError(request.toolId as DocuSignToolId, request.input)
  if (requiredError) {
    return Response.json({ success: false, error: requiredError }, { status: 400 })
  }
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
      },
      { status: 400 }
    )
  }
  const userId = request.context.userId
  if (!userId) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const context: DocuSignOperationContext = {
    requestId: request.requestId,
    signal: request.signal,
    userId,
    workspaceId: request.context.workspaceId,
    workflowId: request.context.workflowId,
    executionId: request.context.executionId,
  }
  try {
    const result = await execute(parsed.data, context)
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof DocuSignOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
}

export const executeDocuSignTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!isDocuSignToolId(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported DocuSign tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  switch (request.toolId) {
    case 'docusign_create_from_template':
      return executeOperation(
        schemas.docusign_create_from_template,
        request,
        executeDocuSignCreateFromTemplate
      )
    case 'docusign_download_document':
      return executeOperation(
        schemas.docusign_download_document,
        request,
        executeDocuSignDownloadDocument
      )
    case 'docusign_get_envelope':
      return executeOperation(schemas.docusign_get_envelope, request, executeDocuSignGetEnvelope)
    case 'docusign_list_envelopes':
      return executeOperation(
        schemas.docusign_list_envelopes,
        request,
        executeDocuSignListEnvelopes
      )
    case 'docusign_list_recipients':
      return executeOperation(
        schemas.docusign_list_recipients,
        request,
        executeDocuSignListRecipients
      )
    case 'docusign_list_templates':
      return executeOperation(
        schemas.docusign_list_templates,
        request,
        executeDocuSignListTemplates
      )
    case 'docusign_send_envelope':
      return executeOperation(schemas.docusign_send_envelope, request, executeDocuSignSendEnvelope)
    case 'docusign_void_envelope':
      return executeOperation(schemas.docusign_void_envelope, request, executeDocuSignVoidEnvelope)
  }
}
