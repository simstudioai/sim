import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('DocuSignAPI')

interface DocuSignAccountInfo {
  accountId: string
  baseUri: string
}

/**
 * Resolves the user's DocuSign account info from their access token
 * by calling the DocuSign userinfo endpoint.
 */
async function resolveAccount(accessToken: string): Promise<DocuSignAccountInfo> {
  const response = await fetch('https://account-d.docusign.com/oauth/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to resolve DocuSign account', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to resolve DocuSign account: ${response.status}`)
  }

  const data = await response.json()
  const accounts = data.accounts ?? []

  const defaultAccount = accounts.find((a: { is_default: boolean }) => a.is_default) ?? accounts[0]
  if (!defaultAccount) {
    throw new Error('No DocuSign accounts found for this user')
  }

  const baseUri = defaultAccount.base_uri
  if (!baseUri) {
    throw new Error('DocuSign account is missing base_uri')
  }

  return {
    accountId: defaultAccount.account_id,
    baseUri,
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { accessToken, operation, ...params } = body

  if (!accessToken) {
    return NextResponse.json({ success: false, error: 'Access token is required' }, { status: 400 })
  }

  if (!operation) {
    return NextResponse.json({ success: false, error: 'Operation is required' }, { status: 400 })
  }

  try {
    const account = await resolveAccount(accessToken)
    const apiBase = `${account.baseUri}/restapi/v2.1/accounts/${account.accountId}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    switch (operation) {
      case 'send_envelope':
        return await handleSendEnvelope(apiBase, headers, params)
      case 'create_from_template':
        return await handleCreateFromTemplate(apiBase, headers, params)
      case 'get_envelope':
        return await handleGetEnvelope(apiBase, headers, params)
      case 'list_envelopes':
        return await handleListEnvelopes(apiBase, headers, params)
      case 'void_envelope':
        return await handleVoidEnvelope(apiBase, headers, params)
      case 'download_document':
        return await handleDownloadDocument(apiBase, headers, params)
      case 'list_templates':
        return await handleListTemplates(apiBase, headers, params)
      case 'list_recipients':
        return await handleListRecipients(apiBase, headers, params)
      default:
        return NextResponse.json(
          { success: false, error: `Unknown operation: ${operation}` },
          { status: 400 }
        )
    }
  } catch (error) {
    logger.error('DocuSign API error', { operation, error })
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})

async function handleSendEnvelope(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
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
        const buffer = await downloadFileFromStorage(userFile, 'docusign-send', logger)
        documentBase64 = buffer.toString('base64')
        documentName = userFile.name
      }
    } catch (fileError) {
      logger.error('Failed to process file for DocuSign envelope', { fileError })
      return NextResponse.json(
        { success: false, error: 'Failed to process uploaded file' },
        { status: 400 }
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

  const response = await fetch(`${apiBase}/envelopes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelopeBody),
  })

  const data = await response.json()
  if (!response.ok) {
    logger.error('DocuSign send envelope failed', { data, status: response.status })
    return NextResponse.json(
      { success: false, error: data.message || data.errorCode || 'Failed to send envelope' },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleCreateFromTemplate(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
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

  const response = await fetch(`${apiBase}/envelopes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelopeBody),
  })

  const data = await response.json()
  if (!response.ok) {
    logger.error('DocuSign create from template failed', { data, status: response.status })
    return NextResponse.json(
      {
        success: false,
        error: data.message || data.errorCode || 'Failed to create envelope from template',
      },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleGetEnvelope(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
) {
  const { envelopeId } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }

  const response = await fetch(
    `${apiBase}/envelopes/${(envelopeId as string).trim()}?include=recipients,documents`,
    { headers }
  )
  const data = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: data.message || data.errorCode || 'Failed to get envelope' },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleListEnvelopes(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
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

  const response = await fetch(`${apiBase}/envelopes?${queryParams}`, { headers })
  const data = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: data.message || data.errorCode || 'Failed to list envelopes' },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleVoidEnvelope(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
) {
  const { envelopeId, voidedReason } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }
  if (!voidedReason) {
    return NextResponse.json({ success: false, error: 'voidedReason is required' }, { status: 400 })
  }

  const response = await fetch(`${apiBase}/envelopes/${(envelopeId as string).trim()}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ status: 'voided', voidedReason }),
  })

  const data = await response.json()
  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: data.message || data.errorCode || 'Failed to void envelope' },
      { status: response.status }
    )
  }

  return NextResponse.json({ envelopeId, status: 'voided' })
}

async function handleDownloadDocument(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
) {
  const { envelopeId, documentId } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }

  const docId = (documentId as string) || 'combined'

  const response = await fetch(
    `${apiBase}/envelopes/${(envelopeId as string).trim()}/documents/${docId}`,
    {
      headers: { Authorization: headers.Authorization },
    }
  )

  if (!response.ok) {
    let errorText = ''
    try {
      errorText = await response.text()
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

  const buffer = Buffer.from(await response.arrayBuffer())
  const base64Content = buffer.toString('base64')

  return NextResponse.json({ base64Content, mimeType: contentType, fileName })
}

async function handleListTemplates(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
) {
  const queryParams = new URLSearchParams()
  if (params.searchText) queryParams.append('search_text', params.searchText as string)
  if (params.count) queryParams.append('count', params.count as string)

  const queryString = queryParams.toString()
  const url = queryString ? `${apiBase}/templates?${queryString}` : `${apiBase}/templates`

  const response = await fetch(url, { headers })
  const data = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: data.message || data.errorCode || 'Failed to list templates' },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}

async function handleListRecipients(
  apiBase: string,
  headers: Record<string, string>,
  params: Record<string, unknown>
) {
  const { envelopeId } = params
  if (!envelopeId) {
    return NextResponse.json({ success: false, error: 'envelopeId is required' }, { status: 400 })
  }

  const response = await fetch(`${apiBase}/envelopes/${(envelopeId as string).trim()}/recipients`, {
    headers,
  })
  const data = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: data.message || data.errorCode || 'Failed to list recipients' },
      { status: response.status }
    )
  }

  return NextResponse.json(data)
}
