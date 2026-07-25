import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { FunctionExecute, UserTable } from '@/lib/copilot/generated/tool-catalog-v1'
import { CopilotOutputFileOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/copilot/generated/trace-events-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import { denyOutputWriteWithoutWritePermission } from '@/lib/copilot/request/tools/permissions'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'

const logger = createLogger('CopilotToolResultFiles')

export const OUTPUT_PATH_TOOLS: Set<string> = new Set([FunctionExecute.id, UserTable.id])

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
 * Unwraps the `function_execute` response envelope `{ result, stdout }` so the
 * rest of the serialization code works on the user's actual payload (a string,
 * array, object, etc.) instead of JSON-stringifying the envelope itself.
 *
 * Only unwraps when both keys are present — that's the unique shape of
 * `function_execute` (see `apps/sim/tools/function/types.ts` `CodeExecutionOutput`).
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
 * payload. Callers are responsible for stripping any `function_execute`
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
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
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

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function convertRowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''

  const headerSet = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key)
    }
  }
  const headers = [...headerSet]

  const lines = [headers.map(escapeCsvValue).join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h])).join(','))
  }
  return lines.join('\n')
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

export function serializeOutputForFile(output: unknown, format: OutputFormat): string {
  const unwrapped = unwrapFunctionExecuteOutput(output)

  if (typeof unwrapped === 'string') return unwrapped

  if (format === 'csv') {
    const rows = extractTabularData(unwrapped)
    if (rows && rows.length > 0) {
      return convertRowsToCsv(rows)
    }
  }

  return JSON.stringify(unwrapped, null, 2)
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
  const args = params?.args as Record<string, unknown> | undefined
  const outputs =
    (params?.outputs as { files?: unknown[] } | undefined) ??
    (args?.outputs as { files?: unknown[] } | undefined)

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

  const outputPath =
    (params?.outputPath as string | undefined) ?? (args?.outputPath as string | undefined)
  if (!outputPath) return []
  const overwriteFileId =
    (params?.overwriteFileId as string | undefined) ?? (args?.overwriteFileId as string | undefined)
  return [
    {
      path: overwriteFileId || outputPath,
      mode: overwriteFileId ? 'overwrite' : 'create',
      formatPath: outputPath,
      format: ((params?.outputFormat as string | undefined) ??
        (args?.outputFormat as string | undefined)) as OutputFormat | undefined,
      mimeType:
        (params?.outputMimeType as string | undefined) ??
        (args?.outputMimeType as string | undefined),
      sandboxPath:
        (params?.outputSandboxPath as string | undefined) ??
        (args?.outputSandboxPath as string | undefined),
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

  const outputObject =
    result.output && typeof result.output === 'object' && !Array.isArray(result.output)
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

  // Only span the actual write path (where we upload to storage). Fast
  // no-op returns above don't need a span — they'd just pad the trace
  // with empty work.
  return withCopilotSpan(
    TraceSpan.CopilotToolsWriteOutputFile,
    {
      [TraceAttr.ToolName]: toolName,
      [TraceAttr.WorkspaceId]: context.workspaceId,
    },
    async (span) => {
      try {
        const writtenFiles = []
        for (const outputFile of outputFiles) {
          const fileName = normalizeOutputWorkspaceFileName(
            outputFile.formatPath ?? outputFile.path
          )
          const format = resolveOutputFormat(fileName, outputFile.format)
          const content = serializeOutputForFile(result.output, format)
          const contentType = outputFile.mimeType || FORMAT_TO_CONTENT_TYPE[format]
          const buffer = Buffer.from(content, 'utf-8')

          if (context.abortSignal?.aborted) {
            throw new Error('Request aborted before tool mutation could be applied')
          }

          const written = await writeWorkspaceFileByPath({
            workspaceId: context.workspaceId!,
            userId: context.userId!,
            target: {
              path: outputFile.path,
              mode: outputFile.mode ?? 'create',
              mimeType: outputFile.mimeType,
            },
            buffer,
            inferredMimeType: contentType,
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
        logger.warn('Failed to write tool output to file', {
          toolName,
          outputPaths: outputFiles.map((file) => file.path),
          error: message,
        })
        span.setAttribute(TraceAttr.CopilotOutputFileOutcome, CopilotOutputFileOutcome.Failed)
        span.addEvent(TraceEvent.CopilotOutputFileError, {
          [TraceAttr.ErrorMessage]: message.slice(0, 500),
        })
        return {
          success: false,
          error: `Failed to write output file: ${message}`,
        }
      }
    }
  )
}
