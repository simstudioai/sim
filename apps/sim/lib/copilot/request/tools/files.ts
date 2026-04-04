import { createLogger } from '@sim/logger'
import { FunctionExecute, UserTable } from '@/lib/copilot/generated/tool-catalog-v1'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('CopilotToolResultFiles')

export const OUTPUT_PATH_TOOLS: Set<string> = new Set([FunctionExecute.id, UserTable.id])

type OutputFormat = 'json' | 'csv' | 'txt' | 'md' | 'html'

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
 * Try to pull a flat array of row-objects out of the various shapes that
 * `function_execute` and `user_table` can return.
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

  // function_execute shape: { result: [...], stdout: "..." }
  if (Array.isArray(obj.result)) {
    const rows = obj.result
    if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      return rows as Record<string, unknown>[]
    }
  }

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
  const trimmed = outputPath.trim().replace(/^\/+/, '')
  const withoutPrefix = trimmed.startsWith('files/') ? trimmed.slice('files/'.length) : trimmed
  if (!withoutPrefix) {
    throw new Error('outputPath must include a file name, e.g. "files/result.json"')
  }
  if (withoutPrefix.includes('/')) {
    throw new Error(
      'outputPath must target a flat workspace file, e.g. "files/result.json". Nested paths like "files/reports/result.json" are not supported.'
    )
  }
  return withoutPrefix
}

export function resolveOutputFormat(fileName: string, explicit?: string): OutputFormat {
  if (explicit && explicit in FORMAT_TO_CONTENT_TYPE) return explicit as OutputFormat
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_FORMAT[ext] ?? 'json'
}

export function serializeOutputForFile(output: unknown, format: OutputFormat): string {
  if (typeof output === 'string') return output

  if (format === 'csv') {
    const rows = extractTabularData(output)
    if (rows && rows.length > 0) {
      return convertRowsToCsv(rows)
    }
  }

  return JSON.stringify(output, null, 2)
}

export async function maybeWriteOutputToFile(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (!result.success || !result.output) return result
  if (!OUTPUT_PATH_TOOLS.has(toolName)) return result
  if (!context.workspaceId || !context.userId) return result

  const args = params?.args as Record<string, unknown> | undefined
  const outputPath =
    (params?.outputPath as string | undefined) ?? (args?.outputPath as string | undefined)
  if (!outputPath) return result
  const outputSandboxPath =
    (params?.outputSandboxPath as string | undefined) ??
    (args?.outputSandboxPath as string | undefined)
  if (toolName === FunctionExecute.id && outputSandboxPath) return result

  const explicitFormat =
    (params?.outputFormat as string | undefined) ?? (args?.outputFormat as string | undefined)

  try {
    const fileName = normalizeOutputWorkspaceFileName(outputPath)
    const format = resolveOutputFormat(fileName, explicitFormat)
    if (context.abortSignal?.aborted) {
      throw new Error('Request aborted before tool mutation could be applied')
    }
    const content = serializeOutputForFile(result.output, format)
    const contentType = FORMAT_TO_CONTENT_TYPE[format]

    const buffer = Buffer.from(content, 'utf-8')
    if (context.abortSignal?.aborted) {
      throw new Error('Request aborted before tool mutation could be applied')
    }
    const uploaded = await uploadWorkspaceFile(
      context.workspaceId,
      context.userId,
      buffer,
      fileName,
      contentType
    )

    logger.info('Tool output written to file', {
      toolName,
      fileName,
      size: buffer.length,
      fileId: uploaded.id,
    })

    return {
      success: true,
      output: {
        message: `Output written to files/${fileName} (${buffer.length} bytes)`,
        fileId: uploaded.id,
        fileName,
        size: buffer.length,
        downloadUrl: uploaded.url,
      },
      resources: [{ type: 'file', id: uploaded.id, title: fileName }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('Failed to write tool output to file', {
      toolName,
      outputPath,
      error: message,
    })
    return {
      success: false,
      error: `Failed to write output file: ${message}`,
    }
  }
}
