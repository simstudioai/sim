import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'
import { RunFunction, UserTable } from '@/lib/mothership/generated/tool-catalog-v1'
import { CopilotOutputFileOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/mothership/generated/trace-events-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/mothership/request/otel'
import { denyOutputWriteWithoutWritePermission } from '@/lib/mothership/request/tools/permissions'
import { projectToolErrorMessageForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import type { ExecutionContext, ToolCallResult } from '@/lib/mothership/request/types'
import { decodeVfsPathSegments } from '@/lib/mothership/vfs/path-utils'
import { writeCopilotWorkspaceFileByPath } from '@/lib/mothership/vfs/resource-writer'
import {
  createWorkspaceFileSecretProvenanceFromRegistry,
  type WorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenanceRepresentation,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import type { ResolvedSecretMatcher } from '@/executor/utils/resolved-secret-matcher'
import {
  createResolvedSecretMatcher,
  scanResolvedSecretString,
} from '@/executor/utils/resolved-secret-matcher'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotToolResultFiles')
const MAX_OUTPUT_FILE_PROVENANCE_REPRESENTATIONS = 10_000

export const OUTPUT_PATH_TOOLS: Set<string> = new Set([RunFunction.id, UserTable.id])

export type OutputFormat = 'json' | 'csv' | 'txt' | 'md' | 'html'

export const EXT_TO_FORMAT: Record<string, OutputFormat> = {
  '.json': 'json',
  '.csv': 'csv',
  '.txt': 'txt',
  '.md': 'md',
  '.html': 'html',
}

export const FORMAT_TO_CONTENT_TYPE: Record<OutputFormat, string> = {
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
}

/**
 * Unwraps the `run_function` response envelope `{ result, stdout }` so the
 * rest of the serialization code works on the user's actual payload (a string,
 * array, object, etc.) instead of JSON-stringifying the envelope itself.
 *
 * Only unwraps when both keys are present — that's the unique shape of
 * `run_function` (see `apps/sim/tools/function/types.ts` `CodeExecutionOutput`).
 * `user_table` returns `{ data, message, success }` which is left alone.
 */
export function unwrapFunctionExecuteOutput(output: unknown): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output
  const obj = output as Record<string, unknown>
  if ('result' in obj && 'stdout' in obj) {
    return obj.result
  }
  return output
}

/**
 * Try to pull a flat array of row-objects out of an already-unwrapped tool
 * payload. Callers are responsible for stripping any `run_function`
 * envelope first (via {@link unwrapFunctionExecuteOutput}) — this function
 * does not re-unwrap, so a user payload that coincidentally has `result` and
 * `stdout` keys is not mistaken for another envelope.
 */
export function extractTabularData(output: unknown): Record<string, unknown>[] | null {
  if (!output || typeof output !== 'object') return null

  if (Array.isArray(output)) {
    if (output.length > 0 && typeof output[0] === 'object' && output[0] !== null) {
      return output as Record<string, unknown>[]
    }
    return null
  }

  const obj = output as Record<string, unknown>

  // user_table query_rows shape: { data: { rows: [{ data: {...} }], totalCount } }
  if (isRecordLike(obj.data)) {
    const data = obj.data as Record<string, unknown>
    if (Array.isArray(data.rows) && data.rows.length > 0) {
      const rows = data.rows as Record<string, unknown>[]
      if (typeof rows[0].data === 'object' && rows[0].data !== null) {
        return rows.map((r) => r.data as Record<string, unknown>)
      }
      return rows
    }
  }

  return null
}

export function normalizeOutputWorkspaceFileName(outputPath: string): string {
  const segments = decodeVfsPathSegments(outputPath.trim().replace(/^\/+|\/+$/g, ''))
  const fileName = segments.at(-1)
  if (!fileName) {
    throw new Error('Output path must include a file name')
  }
  return fileName
}

export function resolveOutputFormat(fileName: string, explicit?: string): OutputFormat {
  if (explicit && explicit in FORMAT_TO_CONTENT_TYPE) return explicit as OutputFormat
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_FORMAT[ext] ?? 'json'
}

interface SerializedOutputFile {
  content: string
  provenanceValue: unknown
  provenanceRepresentations?: readonly WorkspaceFileSecretProvenanceRepresentation[]
  provenanceRepresentationsComplete?: boolean
}

function convertRowsToCsvWithProvenance(
  rows: Record<string, unknown>[],
  registry?: ResolvedSecretTraceRegistry
): {
  content: string
  representations: readonly WorkspaceFileSecretProvenanceRepresentation[]
  representationSourceValues: readonly string[]
  representationsComplete: boolean
} {
  if (rows.length === 0) {
    return {
      content: '',
      representations: [],
      representationSourceValues: [],
      representationsComplete: true,
    }
  }

  const headerSet = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key)
    }
  }
  const headers = [...headerSet]
  const representations = new Map<
    string,
    {
      representation: WorkspaceFileSecretProvenanceRepresentation
      sourceValue: string
    }
  >()
  let representationsComplete = true
  let csvQuoteTransformMatcher: ResolvedSecretMatcher | undefined
  if (registry) {
    try {
      const scanLiterals = new Set<string>()
      for (const { plaintext } of registry.getActiveMatches()) {
        const jsonEncoded = JSON.stringify(plaintext).slice(1, -1)
        if (plaintext.includes('"')) scanLiterals.add(plaintext)
        if (jsonEncoded.includes('"')) scanLiterals.add(jsonEncoded)
      }
      csvQuoteTransformMatcher = createResolvedSecretMatcher(
        [...scanLiterals].map((plaintext) => ({ plaintext, replacement: '' }))
      )
    } catch {
      representationsComplete = false
    }
  }
  const serializeCell = (sourceValue: unknown): string => {
    const persistedValue = formatCsvValue(sourceValue)
    const serializedSource =
      sourceValue === null || sourceValue === undefined
        ? ''
        : typeof sourceValue === 'object'
          ? JSON.stringify(sourceValue)
          : String(sourceValue)
    if (
      registry &&
      csvQuoteTransformMatcher &&
      representationsComplete &&
      serializedSource.includes('"')
    ) {
      try {
        scanResolvedSecretString(serializedSource, csvQuoteTransformMatcher, (scanLiteral) => {
          if (!representationsComplete) return
          const transformedLiteral = scanLiteral.replace(/"/g, '""')
          const sourceProvenance = registry.exportCommittedProvenanceForValue(scanLiteral)
          if (!sourceProvenance.complete) {
            representationsComplete = false
            return
          }
          if (sourceProvenance.entries.length === 0) return
          const representationKey = `${transformedLiteral}\u0000${sourceProvenance.entries
            .map((entry) => `${entry.name ?? ''}\u0000${entry.encryptedValue}`)
            .join('\u0001')}`
          if (representations.has(representationKey)) return
          if (representations.size >= MAX_OUTPUT_FILE_PROVENANCE_REPRESENTATIONS) {
            representationsComplete = false
            return
          }
          representations.set(representationKey, {
            representation: { sourceProvenance, persistedValue: transformedLiteral },
            sourceValue: scanLiteral,
          })
        })
      } catch {
        representationsComplete = false
      }
    }
    return persistedValue
  }

  const lines = [toCsvRow(headers.map(serializeCell))]
  for (const row of rows) {
    lines.push(toCsvRow(headers.map((header) => serializeCell(row[header]))))
  }
  return {
    content: lines.join('\n'),
    representations: [...representations.values()].map(({ representation }) => representation),
    representationSourceValues: [...representations.values()].map(({ sourceValue }) => sourceValue),
    representationsComplete,
  }
}

function prepareOutputForFile(
  output: unknown,
  format: OutputFormat,
  registry?: ResolvedSecretTraceRegistry
): SerializedOutputFile {
  const unwrapped = unwrapFunctionExecuteOutput(output)

  if (typeof unwrapped === 'string') {
    return { content: unwrapped, provenanceValue: unwrapped }
  }

  if (format === 'csv') {
    const rows = extractTabularData(unwrapped)
    if (rows && rows.length > 0) {
      const { content, representations, representationSourceValues, representationsComplete } =
        convertRowsToCsvWithProvenance(rows, registry)
      return {
        content,
        provenanceValue: [content, ...representationSourceValues],
        provenanceRepresentations: representations,
        provenanceRepresentationsComplete: representationsComplete,
      }
    }
  }

  const content = JSON.stringify(unwrapped, null, 2)
  return { content, provenanceValue: content }
}

export function serializeOutputForFile(output: unknown, format: OutputFormat): string {
  return prepareOutputForFile(output, format).content
}

export interface OutputFileDeclaration {
  path: string
  mode?: 'create' | 'overwrite'
  format?: OutputFormat
  mimeType?: string
  sandboxPath?: string
  formatPath?: string
}

export function getOutputFileDeclarations(
  params: Record<string, unknown> | undefined
): OutputFileDeclaration[] {
  // Model-authored wire params: every read is typeof-guarded — a truthy non-string
  // outputPath must never become a file path.
  const stringParam = (key: string): string | undefined => {
    const direct = params?.[key]
    if (typeof direct === 'string' && direct.length > 0) return direct
    const nested = args?.[key]
    return typeof nested === 'string' && nested.length > 0 ? nested : undefined
  }
  const rawArgs = params?.args
  const args =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : undefined
  const rawOutputs = params?.outputs ?? args?.outputs
  const outputs =
    rawOutputs && typeof rawOutputs === 'object' && !Array.isArray(rawOutputs)
      ? (rawOutputs as { files?: unknown[] })
      : undefined

  if (Array.isArray(outputs?.files)) {
    return outputs.files.flatMap((item): OutputFileDeclaration[] => {
      if (!item || typeof item !== 'object') return []
      const file = item as Record<string, unknown>
      if (typeof file.path !== 'string') return []
      return [
        {
          path: file.path,
          mode: file.mode === 'overwrite' ? 'overwrite' : 'create',
          format: typeof file.format === 'string' ? (file.format as OutputFormat) : undefined,
          mimeType: typeof file.mimeType === 'string' ? file.mimeType : undefined,
          sandboxPath: typeof file.sandboxPath === 'string' ? file.sandboxPath : undefined,
        },
      ]
    })
  }

  const outputPath = stringParam('outputPath')
  if (!outputPath) return []
  const overwriteFileId = stringParam('overwriteFileId')
  return [
    {
      path: overwriteFileId ?? outputPath,
      mode: overwriteFileId ? 'overwrite' : 'create',
      formatPath: outputPath,
      format: stringParam('outputFormat') as OutputFormat | undefined,
      mimeType: stringParam('outputMimeType'),
      sandboxPath: stringParam('outputSandboxPath'),
    },
  ]
}

export async function maybeWriteOutputToFile(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (!result.success || !result.output) return result
  if (!OUTPUT_PATH_TOOLS.has(toolName)) return result

  const outputFiles = getOutputFileDeclarations(params).filter((file) => !file.sandboxPath)
  if (outputFiles.length === 0) return result
  // The tool declared workspace file outputs; passing the successful result
  // through without writing them would be a silent no-op the model reads as
  // "file written", so fail loudly instead — but keep the computed output so
  // the model can still use the value without re-running the tool.
  if (!context.workspaceId || !context.userId) {
    logger.warn('Failing tool result: declared output files but no workspace context', {
      toolName,
      outputCount: outputFiles.length,
    })
    return {
      success: false,
      error:
        'Declared output file(s) were NOT written: this tool call has no workspace context. The computed result is included in the output, but it was not saved to any file.',
      output: result.output,
    }
  }
  const { userId, workspaceId } = context

  const outputObject = isRecordLike(result.output)
    ? (result.output as Record<string, unknown>)
    : undefined
  const resultObject =
    outputObject?.result &&
    typeof outputObject.result === 'object' &&
    !Array.isArray(outputObject.result)
      ? (outputObject.result as Record<string, unknown>)
      : undefined
  if (Array.isArray(resultObject?.files)) {
    logger.warn('Skipping returned-value output write because sandbox export response is active', {
      toolName,
      outputCount: outputFiles.length,
    })
    return result
  }

  const denied = denyOutputWriteWithoutWritePermission(context)
  if (denied) return denied

  const registry = context.resolvedSecretTraceRegistry

  // Only span the actual write path (where we upload to storage). Fast
  // no-op returns above don't need a span — they'd just pad the trace
  // with empty work.
  return withCopilotSpan(
    TraceSpan.CopilotToolsWriteOutputFile,
    {
      [TraceAttr.ToolName]: toolName,
      [TraceAttr.WorkspaceId]: workspaceId,
    },
    async (span) => {
      try {
        const preparedByFormat = new Map<
          OutputFormat,
          Promise<{
            buffer: Buffer
            secretProvenance: WorkspaceFileSecretProvenance
          }>
        >()
        const preparedFiles = []
        for (const outputFile of outputFiles) {
          const fileName = normalizeOutputWorkspaceFileName(
            outputFile.formatPath ?? outputFile.path
          )
          const format = resolveOutputFormat(fileName, outputFile.format)
          const contentType = outputFile.mimeType || FORMAT_TO_CONTENT_TYPE[format]
          let prepared = preparedByFormat.get(format)
          if (!prepared) {
            prepared = (async () => {
              const {
                content,
                provenanceValue,
                provenanceRepresentations,
                provenanceRepresentationsComplete,
              } = prepareOutputForFile(result.output, format, registry)
              const decision = await createWorkspaceFileSecretProvenanceFromRegistry(
                registry,
                content,
                { userId, workspaceId },
                provenanceValue,
                provenanceRepresentations,
                provenanceRepresentationsComplete
              )
              return {
                buffer: Buffer.from(content, 'utf-8'),
                secretProvenance: decision.safe ? decision.provenance : { status: 'unknown' },
              }
            })()
            preparedByFormat.set(format, prepared)
          }
          const { buffer, secretProvenance } = await prepared
          preparedFiles.push({ outputFile, format, contentType, buffer, secretProvenance })
        }

        const writtenFiles = []
        for (const { outputFile, format, contentType, buffer, secretProvenance } of preparedFiles) {
          if (context.abortSignal?.aborted) {
            throw new Error('Request aborted before tool mutation could be applied')
          }

          const written = await writeCopilotWorkspaceFileByPath(context, {
            workspaceId,
            target: {
              path: outputFile.path,
              mode: outputFile.mode ?? 'create',
              mimeType: outputFile.mimeType,
            },
            buffer,
            inferredMimeType: contentType,
            secretProvenance,
          })
          writtenFiles.push({
            ...written,
            bytes: buffer.length,
            format,
            requestedPath: outputFile.path,
          })
        }

        const firstWritten = writtenFiles[0]
        span.setAttributes({
          [TraceAttr.CopilotOutputFileId]: firstWritten.id,
          [TraceAttr.CopilotOutputFileName]: firstWritten.name,
          [TraceAttr.CopilotOutputFileFormat]: firstWritten.format,
          [TraceAttr.CopilotOutputFilePath]: firstWritten.vfsPath,
          [TraceAttr.CopilotOutputFileMode]: firstWritten.mode,
          [TraceAttr.CopilotOutputFileBytes]: firstWritten.bytes,
          [TraceAttr.CopilotOutputFileOutcome]: CopilotOutputFileOutcome.Uploaded,
        })

        logger.info('Tool output written to file', {
          toolName,
          outputCount: writtenFiles.length,
          files: writtenFiles.map((file) => ({
            fileId: file.id,
            vfsPath: file.vfsPath,
            size: file.bytes,
          })),
        })

        return {
          success: true,
          output: {
            message:
              writtenFiles.length === 1
                ? `Output ${firstWritten.mode === 'overwrite' ? 'updated' : 'written'} at ${firstWritten.vfsPath} (${firstWritten.bytes} bytes)`
                : `Output written to ${writtenFiles.length} files`,
            files: writtenFiles.map((file) => ({
              fileId: file.id,
              fileName: file.name,
              vfsPath: file.vfsPath,
              size: file.bytes,
              downloadUrl: file.downloadUrl,
            })),
            fileId: firstWritten.id,
            fileName: firstWritten.name,
            vfsPath: firstWritten.vfsPath,
            size: firstWritten.bytes,
            downloadUrl: firstWritten.downloadUrl,
          },
          resources: writtenFiles.map((file) => ({
            type: 'file',
            id: file.id,
            title: file.name,
            path: file.vfsPath,
          })),
        }
      } catch (err) {
        const message = toError(err).message
        const projectedMessage = projectToolErrorMessageForCopilot(
          message,
          context.resolvedSecretTraceRegistry
        )
        logger.warn('Failed to write tool output to file', {
          toolName,
          outputPaths: outputFiles.map((file) => file.path),
          error: projectedMessage,
        })
        span.setAttribute(TraceAttr.CopilotOutputFileOutcome, CopilotOutputFileOutcome.Failed)
        span.addEvent(TraceEvent.CopilotOutputFileError, {
          [TraceAttr.ErrorMessage]: projectedMessage.slice(0, 500),
        })
        return {
          success: false,
          error: `Failed to write output file: ${message}`,
        }
      }
    }
  )
}
