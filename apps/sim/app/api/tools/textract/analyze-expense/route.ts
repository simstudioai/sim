import {
  AnalyzeExpenseCommand,
  type ExpenseDocument,
  GetExpenseAnalysisCommand,
  StartExpenseAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { textractAnalyzeExpenseContract } from '@/lib/api/contracts/tools/media/document-parse'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  mapTextractSdkError,
  parseS3Uri,
  pollTextractJob,
  resolveDocumentInput,
  textractErrorResponse,
} from '@/app/api/tools/textract/shared'

export const dynamic = 'force-dynamic'
/** Mirrors maxDuration in ../parse/route.ts — see that file's TSDoc for details. */
export const maxDuration = 5400

const logger = createLogger('TextractAnalyzeExpenseAPI')

/** Response shape shared by AnalyzeExpense and its async Get* counterpart. */
interface TextractExpenseResult {
  JobStatus?: string
  StatusMessage?: string
  NextToken?: string
  ExpenseDocuments?: ExpenseDocument[]
  DocumentMetadata?: { Pages?: number }
  AnalyzeExpenseModelVersion?: string
}

export function normalizeExpenseField(field: {
  Type?: { Text?: string; Confidence?: number }
  ValueDetection?: { Text?: string; Confidence?: number }
  LabelDetection?: { Text?: string; Confidence?: number }
  PageNumber?: number
  Currency?: { Code?: string; Confidence?: number }
  GroupProperties?: { Id?: string; Types?: string[] }[]
}) {
  return {
    type: { text: field.Type?.Text, confidence: field.Type?.Confidence },
    valueDetection: {
      text: field.ValueDetection?.Text,
      confidence: field.ValueDetection?.Confidence,
    },
    labelDetection: field.LabelDetection
      ? { text: field.LabelDetection.Text, confidence: field.LabelDetection.Confidence }
      : undefined,
    pageNumber: field.PageNumber,
    currency: field.Currency
      ? { code: field.Currency.Code, confidence: field.Currency.Confidence }
      : undefined,
    groupProperties: field.GroupProperties?.map((group) => ({
      id: group.Id ?? '',
      types: group.Types ?? [],
    })),
  }
}

export function normalizeExpenseDocuments(documents: ExpenseDocument[]) {
  return documents.map((doc) => ({
    expenseIndex: doc.ExpenseIndex,
    summaryFields: (doc.SummaryFields ?? []).map(normalizeExpenseField),
    lineItemGroups: (doc.LineItemGroups ?? []).map((group) => ({
      lineItemGroupIndex: group.LineItemGroupIndex,
      lineItems: (group.LineItems ?? []).map((item) => ({
        lineItemExpenseFields: (item.LineItemExpenseFields ?? []).map(normalizeExpenseField),
      })),
    })),
  }))
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Textract analyze-expense attempt`, {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = authResult.userId

    const parsed = await parseRequest(
      textractAnalyzeExpenseContract,
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
    const processingMode = validatedData.processingMode || 'sync'

    logger.info(`[${requestId}] Textract analyze-expense request`, {
      processingMode,
      hasFile: Boolean(validatedData.file),
      hasS3Uri: Boolean(validatedData.s3Uri),
      userId,
    })

    const client = new TextractClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    if (processingMode === 'async') {
      if (!validatedData.s3Uri) {
        return NextResponse.json(
          {
            success: false,
            error: 'S3 URI is required for multi-page processing (s3://bucket/key)',
          },
          { status: 400 }
        )
      }

      const { bucket, key } = parseS3Uri(validatedData.s3Uri)
      logger.info(`[${requestId}] Starting async Textract expense analysis job`, {
        s3Bucket: bucket,
        s3Key: key,
      })

      const { JobId: jobId } = await client.send(
        new StartExpenseAnalysisCommand({
          DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
        })
      )
      if (!jobId) {
        throw new Error('Failed to start Textract expense analysis job: No JobId returned')
      }
      logger.info(`[${requestId}] Async expense analysis job started`, { jobId })

      const result = await pollTextractJob<TextractExpenseResult>(
        requestId,
        logger,
        (nextToken) =>
          client.send(new GetExpenseAnalysisCommand({ JobId: jobId, NextToken: nextToken })),
        (accumulated, page) => ({
          ...accumulated,
          ...page,
          ExpenseDocuments: [
            ...(accumulated.ExpenseDocuments ?? []),
            ...(page.ExpenseDocuments ?? []),
          ],
        })
      )

      return NextResponse.json({
        success: true,
        output: {
          expenseDocuments: normalizeExpenseDocuments(result.ExpenseDocuments ?? []),
          documentMetadata: { pages: result.DocumentMetadata?.Pages ?? 0 },
          modelVersion: result.AnalyzeExpenseModelVersion,
        },
      })
    }

    const resolved = await resolveDocumentInput(
      { file: validatedData.file, filePath: validatedData.filePath },
      userId,
      requestId,
      logger
    )
    if (!resolved.ok) return resolved.response
    const { bytes, isPdf } = resolved.document

    let result: TextractExpenseResult
    try {
      result = await client.send(new AnalyzeExpenseCommand({ Document: { Bytes: bytes } }))
    } catch (error) {
      throw mapTextractSdkError(error, isPdf)
    }

    logger.info(`[${requestId}] Textract analyze-expense successful`, {
      pageCount: result.DocumentMetadata?.Pages ?? 0,
      expenseDocumentCount: result.ExpenseDocuments?.length ?? 0,
    })

    return NextResponse.json({
      success: true,
      output: {
        expenseDocuments: normalizeExpenseDocuments(result.ExpenseDocuments ?? []),
        documentMetadata: { pages: result.DocumentMetadata?.Pages ?? 0 },
      },
    })
  } catch (error) {
    return textractErrorResponse(error, requestId, logger)
  }
})
