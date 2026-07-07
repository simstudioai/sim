import {
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
  type FeatureType,
  GetDocumentAnalysisCommand,
  GetDocumentTextDetectionCommand,
  StartDocumentAnalysisCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
} from '@aws-sdk/client-textract'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { textractParseContract } from '@/lib/api/contracts/tools/media/document-parse'
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
/**
 * Mirrors the maximum plan execution timeout (enterprise async, 90 minutes) used by
 * `getMaxExecutionTimeout()` for the job polling loop below. Next.js requires a static
 * literal for `maxDuration`, so this value must be kept in sync with that source.
 */
export const maxDuration = 5400

const logger = createLogger('TextractParseAPI')

/** Response shape shared by AnalyzeDocument/DetectDocumentText and their async Get* counterparts. */
interface TextractDocumentResult {
  JobStatus?: string
  StatusMessage?: string
  NextToken?: string
  Blocks?: unknown[]
  DocumentMetadata?: { Pages?: number }
  AnalyzeDocumentModelVersion?: string
  DetectDocumentTextModelVersion?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Textract parse attempt`, {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = authResult.userId

    const parsed = await parseRequest(
      textractParseContract,
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
    const featureTypes = (validatedData.featureTypes ?? []) as FeatureType[]
    const useAnalyzeDocument = featureTypes.length > 0
    const queriesConfig =
      validatedData.queries && validatedData.queries.length > 0 && featureTypes.includes('QUERIES')
        ? {
            Queries: validatedData.queries.map((q) => ({
              Text: q.Text,
              Alias: q.Alias,
              Pages: q.Pages,
            })),
          }
        : undefined

    logger.info(`[${requestId}] Textract parse request`, {
      processingMode,
      hasFile: Boolean(validatedData.file),
      hasS3Uri: Boolean(validatedData.s3Uri),
      featureTypes,
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
      logger.info(`[${requestId}] Starting async Textract job`, { s3Bucket: bucket, s3Key: key })

      const { JobId: jobId } = useAnalyzeDocument
        ? await client.send(
            new StartDocumentAnalysisCommand({
              DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
              FeatureTypes: featureTypes,
              QueriesConfig: queriesConfig,
            })
          )
        : await client.send(
            new StartDocumentTextDetectionCommand({
              DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
            })
          )
      if (!jobId) {
        throw new Error('Failed to start Textract job: No JobId returned')
      }
      logger.info(`[${requestId}] Async job started`, { jobId })

      const result = await pollTextractJob<TextractDocumentResult>(
        requestId,
        logger,
        async (nextToken) =>
          useAnalyzeDocument
            ? await client.send(
                new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken })
              )
            : await client.send(
                new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken })
              ),
        (accumulated, page) => ({
          ...page,
          Blocks: [...(accumulated.Blocks ?? []), ...(page.Blocks ?? [])],
        })
      )

      logger.info(`[${requestId}] Textract async parse successful`, {
        pageCount: result.DocumentMetadata?.Pages ?? 0,
        blockCount: result.Blocks?.length ?? 0,
      })

      return NextResponse.json({
        success: true,
        output: {
          blocks: result.Blocks ?? [],
          documentMetadata: { pages: result.DocumentMetadata?.Pages ?? 0 },
          modelVersion: result.AnalyzeDocumentModelVersion ?? result.DetectDocumentTextModelVersion,
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

    let result: TextractDocumentResult
    try {
      result = useAnalyzeDocument
        ? await client.send(
            new AnalyzeDocumentCommand({
              Document: { Bytes: bytes },
              FeatureTypes: featureTypes,
              QueriesConfig: queriesConfig,
            })
          )
        : await client.send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }))
    } catch (error) {
      throw mapTextractSdkError(error, isPdf)
    }

    logger.info(`[${requestId}] Textract parse successful`, {
      pageCount: result.DocumentMetadata?.Pages ?? 0,
      blockCount: result.Blocks?.length ?? 0,
    })

    return NextResponse.json({
      success: true,
      output: {
        blocks: result.Blocks ?? [],
        documentMetadata: { pages: result.DocumentMetadata?.Pages ?? 0 },
        modelVersion: result.AnalyzeDocumentModelVersion ?? result.DetectDocumentTextModelVersion,
      },
    })
  } catch (error) {
    return textractErrorResponse(error, requestId, logger)
  }
})
