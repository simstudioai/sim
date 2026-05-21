import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { docusignToolContract } from '@/lib/api/contracts/tools/docusign'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  assertKnownSizeWithinLimit,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('DocuSignAPI')
const MAX_DOCUSIGN_DOCUMENT_BYTES = 25 * 1024 * 1024
const MAX_LEGACY_INLINE_DOCUMENT_BYTES = 7 * 1024 * 1024
const MAX_DOCUSIGN_JSON_BYTES = 2 * 1024 * 1024
const DOCUSIGN_FETCH_TIMEOUT_MS = 30_000

interface DocuSignAccountInfo {
  accountId: string
  baseUri: string
}

async function readDocusignJson(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  return readResponseJsonWithLimit<Record<string, unknown>>(response, {
    maxBytes: MAX_DOCUSIGN_JSON_BYTES,
    label,
  })
}

function docusignError(data: Record<string, unknown>, fallback: string): string {
  return (
    (typeof data.message === 'string' && data.message) ||
    (typeof data.errorCode === 'string' && data.errorCode) ||
    fallback
  )
}

async function fetchDocusign(
  input: string,
  init: RequestInit = {},
  parentSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error('DocuSign request timed out'))
  }, DOCUSIGN_FETCH_TIMEOUT_MS)
  const abort = () => controller.abort(parentSignal?.reason ?? new Error('Request aborted'))
  parentSignal?.addEventListener('abort', abort, { once: true })

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', abort)
  }
}

/**
 * Resolves the user's DocuSign account info from their access token
 * by calling the DocuSign userinfo endpoint.
 */
async function resolveAccount(
  accessToken: string,
  signal?: AbortSignal
): Promise<DocuSignAccountInfo> {
  const response = await fetchDocusign(
    'https://account-d.docusign.com/oauth/userinfo',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    signal
  )

  if (!response.ok) {
    const errorText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'DocuSign account error response',
    }).catch(() => '')
    logger.error('Failed to resolve DocuSign account', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to resolve DocuSign account: ${response.status}`)
  }

  const data = await readDocusignJson(response, 'DocuSign account response')
  const accounts = Array.isArray(data.accounts)
    ? (data.accounts as Array<{
        is_default?: boolean
        base_uri?: string
        account_id?: string
      }>)
    : []

  const defaultAccount = accounts.find((account) => account.is_default) ?? accounts[0]
  if (!defaultAccount) {
    throw new Error('No DocuSign accounts found for this user')
  }

  const baseUri = defaultAccount.base_uri
  if (!baseUri) {
    throw new Error('DocuSign account is missing base_uri')
  }
  const accountId = defaultAccount.account_id
  if (!accountId) {
    throw new Error('DocuSign account is missing account_id')
  }

  return {
    accountId,
    baseUri,
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    docusignToolContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json(
          { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
          { status: 400 }
        ),
    }
  )
  if (!parsed.success) return parsed.response

  const { accessToken, operation, ...params } = parsed.data.body

  try {
    const account = await resolveAccount(accessToken, request.signal)
    const apiBase = `${account.baseUri}/restapi/v2.1/accounts/${account.accountId}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    switch (operation) {
      case 'send_envelope':
        return await handleSendEnvelope(apiBase, headers, params, authResult.userId, request.signal)
      case 'create_from_template':
        return await handleCreateFromTemplate(apiBase, headers, params, request.signal)
      case 'get_envelope':
        return await handleGetEnvelope(apiBase, headers, params, request.signal)
      case 'list_envelopes':
        return await handleListEnvelopes(apiBase, headers, params, request.signal)
      case 'void_envelope':
        return await handleVoidEnvelope(apiBase, headers, params, request.signal)
      case 'download_document':
        return await handleDownloadDocument(
          apiBase,
          headers,
          params,
          authResult.userId,
          request.signal
        )
      case 'list_templates':
        return await handleListTemplates(apiBase, headers, params, request.signal)
      case 'list_recipients':
        return await handleListRecipients(apiBase, headers, params, request.signal)
      default:
        return NextResponse.json(
          { success: false, error: `Unknown operation: ${operation}` },
          { status: 400 }
        )
    }
  } catch (error) {
    logger.error('DocuSign API error', { operation, error })
    const message = getErrorMessage(error, 'Internal server error')
    return NextResponse.json(
      { success: false, error: message },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})

async function handleSendEnvelope(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  userId: string,
  signal?: AbortSignal
) {
  const { signerEmail, signerName, emailSubject, emailBody, ccEmail, ccName, file, status } = params

  if (!signerEmail || !signerName || !emailSubject) {
    return NextResponse.json(
      { success: false, error: 'signerEmail, signerName, and emailSubject are required' },
      { status: 400 }
    )
  }

  let documentBase64 = ''
  let documentName = 'document.pdf'

  if (file) {
    try {
      const parsed = FileInputSchema.parse(file)
      const userFiles = processFilesToUserFiles([parsed as RawFileInput], 'docusign-send', logger)
      if (userFiles.length > 0) {
        const userFile = userFiles[0]
        const denied = await assertToolFileAccess(userFile.key, userId, 'docusign-send', logger)
        if (denied) return denied
        if (userFile.size > MAX_DOCUSIGN_DOCUMENT_BYTES) {
          return NextResponse.json(
            { success: false, error: 'Document is too large to send through DocuSign' },
            { status: 413 }
          )
        }
        const buffer = await downloadFileFromStorage(userFile, 'docusign-send', logger, {
          maxBytes: MAX_DOCUSIGN_DOCUMENT_BYTES,
        })
        assertKnownSizeWithinLimit(buffer.length, MAX_DOCUSIGN_DOCUMENT_BYTES, 'DocuSign document')
        documentBase64 = buffer.toString('base64')
        documentName = userFile.name
      }
    } catch (fileError) {
      logger.error('Failed to process file for DocuSign envelope', { fileError })
      return NextResponse.json(
        {
          success: false,
          error: isPayloadSizeLimitError(fileError)
            ? getErrorMessage(fileError, 'Document is too large to send through DocuSign')
            : 'Failed to process uploaded file',
        },
        { status: isPayloadSizeLimitError(fileError) ? 413 : 400 }
      )
    }
  }

  const envelopeBody: Record<string, unknown> = {
    emailSubject,
    status: (status as string) || 'sent',
    recipients: {
      signers: [
        {
          email: signerEmail,
          name: signerName,
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
      carbonCopies: ccEmail
        ? [
            {
              email: ccEmail,
              name: ccName || (ccEmail as string),
              recipientId: '2',
              routingOrder: '2',
            },
          ]
        : [],
    },
  }

  if (emailBody) {
    envelopeBody.emailBlurb = emailBody
  }

  if (documentBase64) {
    envelopeBody.documents = [
      {
        documentBase64,
        name: documentName,
        fileExtension: documentName.split('.').pop() || 'pdf',
        documentId: '1',
      },
    ]
  } else if (((status as string) || 'sent') === 'sent') {
    return NextResponse.json(
      { success: false, error: 'A document file is required to send an envelope' },
      { status: 400 }
    )
  }

  const response = await fetchDocusign(
    `${apiBase}/envelopes`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(envelopeBody),
    },
    signal
  )

  const data = await readDocusignJson(response, 'DocuSign send envelope response')
  if (!response.ok) {
    logger.error('DocuSign send envelope failed', { data, status: response.status })
    return NextResponse.json(
      { success: false, error: docusignError(data, 'Failed to send envelope') },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleCreateFromTemplate(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const { templateId, emailSubject, emailBody, templateRoles, status } = params

  if (!templateId) {
    return NextResponse.json({ success: false, error: 'templateId is required' }, { status: 400 })
  }

  let parsedRoles: unknown[] = []
  if (templateRoles) {
    if (typeof templateRoles === 'string') {
      try {
        parsedRoles = JSON.parse(templateRoles)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid JSON for templateRoles' },
          { status: 400 }
        )
      }
    } else if (Array.isArray(templateRoles)) {
      parsedRoles = templateRoles
    }
  }

  const envelopeBody: Record<string, unknown> = {
    templateId,
    status: (status as string) || 'sent',
    templateRoles: parsedRoles,
  }

  if (emailSubject) envelopeBody.emailSubject = emailSubject
  if (emailBody) envelopeBody.emailBlurb = emailBody

  const response = await fetchDocusign(
    `${apiBase}/envelopes`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(envelopeBody),
    },
    signal
  )

  const data = await readDocusignJson(response, 'DocuSign create from template response')
  if (!response.ok) {
    logger.error('DocuSign create from template failed', { data, status: response.status })
    return NextResponse.json(
      {
        success: false,
        error: docusignError(data, 'Failed to create envelope from template'),
      },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleGetEnvelope(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const { envelopeId } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }

  const response = await fetchDocusign(
    `${apiBase}/envelopes/${(envelopeId as string).trim()}?include=recipients,documents`,
    { headers },
    signal
  )
  const data = await readDocusignJson(response, 'DocuSign envelope response')

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: docusignError(data, 'Failed to get envelope') },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleListEnvelopes(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const queryParams = new URLSearchParams()

  const fromDate = params.fromDate as string | undefined
  if (fromDate) {
    queryParams.append('from_date', fromDate)
  } else {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    queryParams.append('from_date', thirtyDaysAgo.toISOString())
  }

  if (params.toDate) queryParams.append('to_date', params.toDate as string)
  if (params.envelopeStatus) queryParams.append('status', params.envelopeStatus as string)
  if (params.searchText) queryParams.append('search_text', params.searchText as string)
  if (params.count) queryParams.append('count', params.count as string)

  const response = await fetchDocusign(`${apiBase}/envelopes?${queryParams}`, { headers }, signal)
  const data = await readDocusignJson(response, 'DocuSign envelope list response')

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: docusignError(data, 'Failed to list envelopes') },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleVoidEnvelope(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const { envelopeId, voidedReason } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }
  if (!voidedReason) {
    return NextResponse.json({ success: false, error: 'voidedReason is required' }, { status: 400 })
  }

  const response = await fetchDocusign(
    `${apiBase}/envelopes/${(envelopeId as string).trim()}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'voided', voidedReason }),
    },
    signal
  )

  const data = await readDocusignJson(response, 'DocuSign void envelope response')
  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: docusignError(data, 'Failed to void envelope') },
      { status: response.status }
    )
  }

  return NextResponse.json({ envelopeId, status: 'voided' })
}

async function handleDownloadDocument(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  userId: string,
  signal?: AbortSignal
) {
  const { envelopeId, documentId } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }

  const docId = (documentId as string) || 'combined'

  const response = await fetchDocusign(
    `${apiBase}/envelopes/${(envelopeId as string).trim()}/documents/${docId}`,
    {
      headers: { Authorization: headers.Authorization },
    },
    signal
  )

  if (!response.ok) {
    let errorText = ''
    try {
      errorText = await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'DocuSign document error response',
      })
    } catch {
      // ignore
    }
    return NextResponse.json(
      { success: false, error: `Failed to download document: ${response.status} ${errorText}` },
      { status: response.status }
    )
  }

  const contentType = response.headers.get('content-type') || 'application/pdf'
  const contentDisposition = response.headers.get('content-disposition') || ''
  let fileName = `document-${docId}.pdf`

  const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
  if (filenameMatch) {
    fileName = filenameMatch[1].replace(/['"]/g, '')
  }

  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_DOCUSIGN_DOCUMENT_BYTES,
    label: 'DocuSign document download',
  })

  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined
  const workflowId = typeof params.workflowId === 'string' ? params.workflowId : undefined
  const executionId = typeof params.executionId === 'string' ? params.executionId : undefined
  const legacyInlineContent =
    buffer.length <= MAX_LEGACY_INLINE_DOCUMENT_BYTES
      ? { base64Content: buffer.toString('base64') }
      : {}

  if (workspaceId && workflowId && executionId) {
    const file = await uploadExecutionFile(
      { workspaceId, workflowId, executionId },
      buffer,
      fileName,
      contentType,
      userId
    )
    return NextResponse.json({
      file,
      mimeType: contentType,
      fileName,
      ...legacyInlineContent,
    })
  }

  const file = await uploadCopilotFile({
    buffer,
    fileName,
    contentType,
    userId,
  })

  return NextResponse.json({ file, mimeType: contentType, fileName, ...legacyInlineContent })
}

async function handleListTemplates(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const queryParams = new URLSearchParams()
  if (params.searchText) queryParams.append('search_text', params.searchText as string)
  if (params.count) queryParams.append('count', params.count as string)

  const queryString = queryParams.toString()
  const url = queryString ? `${apiBase}/templates?${queryString}` : `${apiBase}/templates`

  const response = await fetchDocusign(url, { headers }, signal)
  const data = await readDocusignJson(response, 'DocuSign template list response')

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: docusignError(data, 'Failed to list templates') },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleListRecipients(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const { envelopeId } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }

  const response = await fetchDocusign(
    `${apiBase}/envelopes/${(envelopeId as string).trim()}/recipients`,
    {
      headers,
    },
    signal
  )
  const data = await readDocusignJson(response, 'DocuSign recipients response')

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: docusignError(data, 'Failed to list recipients') },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}
