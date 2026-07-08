import { AnalyzeIDCommand, type IdentityDocument, TextractClient } from '@aws-sdk/client-textract'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { textractAnalyzeIdContract } from '@/lib/api/contracts/tools/media/document-parse'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  mapTextractSdkError,
  resolveDocumentInput,
  textractErrorResponse,
} from '@/app/api/tools/textract/shared'

export const dynamic = 'force-dynamic'

const logger = createLogger('TextractAnalyzeIdAPI')

export function normalizeIdentityDocuments(documents: IdentityDocument[]) {
  return documents.map((doc) => ({
    documentIndex: doc.DocumentIndex,
    identityDocumentFields: (doc.IdentityDocumentFields ?? []).map((field) => ({
      type: {
        text: field.Type?.Text,
        confidence: field.Type?.Confidence,
        normalizedValue: field.Type?.NormalizedValue
          ? {
              value: field.Type.NormalizedValue.Value,
              valueType: field.Type.NormalizedValue.ValueType,
            }
          : undefined,
      },
      valueDetection: {
        text: field.ValueDetection?.Text,
        confidence: field.ValueDetection?.Confidence,
        normalizedValue: field.ValueDetection?.NormalizedValue
          ? {
              value: field.ValueDetection.NormalizedValue.Value,
              valueType: field.ValueDetection.NormalizedValue.ValueType,
            }
          : undefined,
      },
    })),
  }))
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Textract analyze-id attempt`, {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = authResult.userId

    const parsed = await parseRequest(
      textractAnalyzeIdContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request data`, { errors: error.issues })
          return NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Textract analyze-id request`, {
      hasFile: Boolean(validatedData.file),
      hasBackFile: Boolean(validatedData.fileBack || validatedData.filePathBack),
      userId,
    })

    const front = await resolveDocumentInput(
      { file: validatedData.file, filePath: validatedData.filePath },
      userId,
      requestId,
      logger
    )
    if (!front.ok) return front.response

    const documentPages = [{ Bytes: front.document.bytes }]
    let isPdf = front.document.isPdf

    if (validatedData.fileBack || validatedData.filePathBack) {
      const back = await resolveDocumentInput(
        { file: validatedData.fileBack, filePath: validatedData.filePathBack },
        userId,
        requestId,
        logger
      )
      if (!back.ok) return back.response
      documentPages.push({ Bytes: back.document.bytes })
      isPdf = isPdf || back.document.isPdf
    }

    const client = new TextractClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    let result: {
      AnalyzeIDModelVersion?: string
      DocumentMetadata?: { Pages?: number }
      IdentityDocuments?: IdentityDocument[]
    }
    try {
      result = await client.send(new AnalyzeIDCommand({ DocumentPages: documentPages }))
    } catch (error) {
      throw mapTextractSdkError(error, isPdf, { hasAsyncMode: false })
    }

    logger.info(`[${requestId}] Textract analyze-id successful`, {
      pageCount: result.DocumentMetadata?.Pages ?? 0,
      documentCount: result.IdentityDocuments?.length ?? 0,
    })

    return NextResponse.json({
      success: true,
      output: {
        identityDocuments: normalizeIdentityDocuments(result.IdentityDocuments ?? []),
        documentMetadata: { pages: result.DocumentMetadata?.Pages ?? 0 },
        modelVersion: result.AnalyzeIDModelVersion,
      },
    })
  } catch (error) {
    return textractErrorResponse(error, requestId, logger)
  }
})
