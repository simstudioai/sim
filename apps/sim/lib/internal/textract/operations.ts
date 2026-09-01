import {
  AnalyzeDocumentCommand,
  AnalyzeExpenseCommand,
  AnalyzeIDCommand,
  DetectDocumentTextCommand,
  type ExpenseDocument,
  type FeatureType,
  GetDocumentAnalysisCommand,
  GetDocumentTextDetectionCommand,
  GetExpenseAnalysisCommand,
  StartDocumentAnalysisCommand,
  StartDocumentTextDetectionCommand,
  StartExpenseAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { ContractBody } from '@/lib/api/contracts'
import type {
  textractAnalyzeExpenseContract,
  textractAnalyzeIdContract,
  textractParseContract,
} from '@/lib/api/contracts/tools/media/document-parse'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { parseS3Uri, resolveDocumentInput } from '@/lib/internal/textract/document-input'
import { mapTextractSdkError, textractErrorResponse } from '@/lib/internal/textract/errors'
import {
  normalizeExpenseDocuments,
  normalizeIdentityDocuments,
} from '@/lib/internal/textract/normalizers'
import { pollTextractJob } from '@/lib/internal/textract/poll-job'

type TextractParseInput = ContractBody<typeof textractParseContract>
type TextractAnalyzeExpenseInput = ContractBody<typeof textractAnalyzeExpenseContract>
type TextractAnalyzeIdInput = ContractBody<typeof textractAnalyzeIdContract>

export interface TextractOperationContext {
  headers: Headers
  userId: string
  requestId: string
  signal?: AbortSignal
}

interface TextractDocumentResult {
  JobStatus?: string
  StatusMessage?: string
  NextToken?: string
  Blocks?: unknown[]
  DocumentMetadata?: { Pages?: number }
  AnalyzeDocumentModelVersion?: string
  DetectDocumentTextModelVersion?: string
}

interface TextractExpenseResult {
  JobStatus?: string
  StatusMessage?: string
  NextToken?: string
  ExpenseDocuments?: ExpenseDocument[]
  DocumentMetadata?: { Pages?: number }
  AnalyzeExpenseModelVersion?: string
}

const parseLogger = createLogger('TextractParseAPI')
const expenseLogger = createLogger('TextractAnalyzeExpenseAPI')
const identityLogger = createLogger('TextractAnalyzeIdAPI')

function validateModelInputProvenance(input: unknown, headers: Headers): NextResponse | undefined {
  const provenance = validateOpaqueModelInputProvenance({
    headers,
    payload: input,
    isInternalRequest: true,
  })
  if (provenance.success) return undefined
  return NextResponse.json(
    { success: false, error: provenance.error },
    { status: provenance.status }
  )
}

function createTextractClient(input: {
  region: string
  accessKeyId: string
  secretAccessKey: string
}): TextractClient {
  return new TextractClient({
    region: input.region,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  })
}

export async function executeTextractParse(
  input: TextractParseInput,
  context: TextractOperationContext
): Promise<Response> {
  const { headers, userId, requestId, signal } = context
  try {
    const provenanceError = validateModelInputProvenance(input, headers)
    if (provenanceError) return provenanceError

    const processingMode = input.processingMode || 'sync'
    const featureTypes = (input.featureTypes ?? []) as FeatureType[]
    const useAnalyzeDocument = featureTypes.length > 0
    const queriesConfig =
      input.queries && input.queries.length > 0 && featureTypes.includes('QUERIES')
        ? {
            Queries: input.queries.map((query) => ({
              Text: query.Text,
              Alias: query.Alias,
              Pages: query.Pages,
            })),
          }
        : undefined

    parseLogger.info(`[${requestId}] Textract parse request`, {
      processingMode,
      hasFile: Boolean(input.file),
      hasS3Uri: Boolean(input.s3Uri),
      featureTypes,
      userId,
    })

    if (processingMode === 'async') {
      if (!input.s3Uri) {
        return NextResponse.json(
          {
            success: false,
            error: 'S3 URI is required for multi-page processing (s3://bucket/key)',
          },
          { status: 400 }
        )
      }

      const { bucket, key } = parseS3Uri(input.s3Uri)
      parseLogger.info(`[${requestId}] Starting async Textract job`, {
        s3Bucket: bucket,
        s3Key: key,
      })
      const client = createTextractClient(input)
      try {
        const { JobId: jobId } = useAnalyzeDocument
          ? await client.send(
              new StartDocumentAnalysisCommand({
                DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
                FeatureTypes: featureTypes,
                QueriesConfig: queriesConfig,
              }),
              { abortSignal: signal }
            )
          : await client.send(
              new StartDocumentTextDetectionCommand({
                DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
              }),
              { abortSignal: signal }
            )
        if (!jobId) throw new Error('Failed to start Textract job: No JobId returned')
        parseLogger.info(`[${requestId}] Async job started`, { jobId })

        const result = await pollTextractJob<TextractDocumentResult>(
          requestId,
          parseLogger,
          async (nextToken) =>
            useAnalyzeDocument
              ? await client.send(
                  new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken }),
                  { abortSignal: signal }
                )
              : await client.send(
                  new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken }),
                  { abortSignal: signal }
                ),
          (accumulated, page) => ({
            ...accumulated,
            ...page,
            Blocks: [...(accumulated.Blocks ?? []), ...(page.Blocks ?? [])],
          }),
          signal
        )

        parseLogger.info(`[${requestId}] Textract async parse successful`, {
          pageCount: result.DocumentMetadata?.Pages ?? 0,
          blockCount: result.Blocks?.length ?? 0,
        })
        return NextResponse.json({
          success: true,
          output: {
            blocks: result.Blocks ?? [],
            documentMetadata: { pages: result.DocumentMetadata?.Pages ?? 0 },
            modelVersion:
              result.AnalyzeDocumentModelVersion ?? result.DetectDocumentTextModelVersion,
          },
        })
      } finally {
        client.destroy()
      }
    }

    const resolved = await resolveDocumentInput(
      { file: input.file, filePath: input.filePath },
      userId,
      requestId,
      parseLogger,
      signal
    )
    if (!resolved.ok) return resolved.response

    const client = createTextractClient(input)
    try {
      let result: TextractDocumentResult
      try {
        result = useAnalyzeDocument
          ? await client.send(
              new AnalyzeDocumentCommand({
                Document: { Bytes: resolved.document.bytes },
                FeatureTypes: featureTypes,
                QueriesConfig: queriesConfig,
              }),
              { abortSignal: signal }
            )
          : await client.send(
              new DetectDocumentTextCommand({ Document: { Bytes: resolved.document.bytes } }),
              { abortSignal: signal }
            )
      } catch (error) {
        signal?.throwIfAborted()
        throw mapTextractSdkError(error, resolved.document.isPdf)
      }

      parseLogger.info(`[${requestId}] Textract parse successful`, {
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
    } finally {
      client.destroy()
    }
  } catch (error) {
    signal?.throwIfAborted()
    return textractErrorResponse(error, requestId, parseLogger)
  }
}

export async function executeTextractAnalyzeExpense(
  input: TextractAnalyzeExpenseInput,
  context: TextractOperationContext
): Promise<Response> {
  const { headers, userId, requestId, signal } = context
  try {
    const provenanceError = validateModelInputProvenance(input, headers)
    if (provenanceError) return provenanceError
    const processingMode = input.processingMode || 'sync'

    expenseLogger.info(`[${requestId}] Textract analyze-expense request`, {
      processingMode,
      hasFile: Boolean(input.file),
      hasS3Uri: Boolean(input.s3Uri),
      userId,
    })

    if (processingMode === 'async') {
      if (!input.s3Uri) {
        return NextResponse.json(
          {
            success: false,
            error: 'S3 URI is required for multi-page processing (s3://bucket/key)',
          },
          { status: 400 }
        )
      }
      const { bucket, key } = parseS3Uri(input.s3Uri)
      expenseLogger.info(`[${requestId}] Starting async Textract expense analysis job`, {
        s3Bucket: bucket,
        s3Key: key,
      })
      const client = createTextractClient(input)
      try {
        const { JobId: jobId } = await client.send(
          new StartExpenseAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
          }),
          { abortSignal: signal }
        )
        if (!jobId) {
          throw new Error('Failed to start Textract expense analysis job: No JobId returned')
        }
        expenseLogger.info(`[${requestId}] Async expense analysis job started`, { jobId })

        const result = await pollTextractJob<TextractExpenseResult>(
          requestId,
          expenseLogger,
          (nextToken) =>
            client.send(new GetExpenseAnalysisCommand({ JobId: jobId, NextToken: nextToken }), {
              abortSignal: signal,
            }),
          (accumulated, page) => ({
            ...accumulated,
            ...page,
            ExpenseDocuments: [
              ...(accumulated.ExpenseDocuments ?? []),
              ...(page.ExpenseDocuments ?? []),
            ],
          }),
          signal
        )

        return NextResponse.json({
          success: true,
          output: {
            expenseDocuments: normalizeExpenseDocuments(result.ExpenseDocuments ?? []),
            documentMetadata: { pages: result.DocumentMetadata?.Pages ?? 0 },
            modelVersion: result.AnalyzeExpenseModelVersion,
          },
        })
      } finally {
        client.destroy()
      }
    }

    const resolved = await resolveDocumentInput(
      { file: input.file, filePath: input.filePath },
      userId,
      requestId,
      expenseLogger,
      signal
    )
    if (!resolved.ok) return resolved.response

    const client = createTextractClient(input)
    try {
      let result: TextractExpenseResult
      try {
        result = await client.send(
          new AnalyzeExpenseCommand({ Document: { Bytes: resolved.document.bytes } }),
          { abortSignal: signal }
        )
      } catch (error) {
        signal?.throwIfAborted()
        throw mapTextractSdkError(error, resolved.document.isPdf)
      }

      expenseLogger.info(`[${requestId}] Textract analyze-expense successful`, {
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
    } finally {
      client.destroy()
    }
  } catch (error) {
    signal?.throwIfAborted()
    return textractErrorResponse(error, requestId, expenseLogger)
  }
}

export async function executeTextractAnalyzeId(
  input: TextractAnalyzeIdInput,
  context: TextractOperationContext
): Promise<Response> {
  const { headers, userId, requestId, signal } = context
  try {
    const provenanceError = validateModelInputProvenance(input, headers)
    if (provenanceError) return provenanceError

    identityLogger.info(`[${requestId}] Textract analyze-id request`, {
      hasFile: Boolean(input.file),
      hasBackFile: Boolean(input.fileBack || input.filePathBack),
      userId,
    })

    const front = await resolveDocumentInput(
      { file: input.file, filePath: input.filePath },
      userId,
      requestId,
      identityLogger,
      signal
    )
    if (!front.ok) return front.response

    const documentPages = [{ Bytes: front.document.bytes }]
    let isPdf = front.document.isPdf
    if (input.fileBack || input.filePathBack) {
      const back = await resolveDocumentInput(
        { file: input.fileBack, filePath: input.filePathBack },
        userId,
        requestId,
        identityLogger,
        signal
      )
      if (!back.ok) return back.response
      documentPages.push({ Bytes: back.document.bytes })
      isPdf = isPdf || back.document.isPdf
    }

    const client = createTextractClient(input)
    try {
      let result: {
        AnalyzeIDModelVersion?: string
        DocumentMetadata?: { Pages?: number }
        IdentityDocuments?: import('@aws-sdk/client-textract').IdentityDocument[]
      }
      try {
        result = await client.send(new AnalyzeIDCommand({ DocumentPages: documentPages }), {
          abortSignal: signal,
        })
      } catch (error) {
        signal?.throwIfAborted()
        throw mapTextractSdkError(error, isPdf, { hasAsyncMode: false })
      }

      identityLogger.info(`[${requestId}] Textract analyze-id successful`, {
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
    } finally {
      client.destroy()
    }
  } catch (error) {
    signal?.throwIfAborted()
    return textractErrorResponse(error, requestId, identityLogger)
  }
}
