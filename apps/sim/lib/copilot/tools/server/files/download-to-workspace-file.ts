import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getExtensionFromMimeType,
  getFileExtension,
  getMimeTypeFromExtension,
} from '@/lib/uploads/utils/file-utils'

const logger = createLogger('DownloadToWorkspaceFileTool')

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const DownloadToWorkspaceFileArgsSchema = z.object({
  url: z.string().url(),
  fileName: z.string().min(1).optional(),
})

const DownloadToWorkspaceFileResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  fileId: z.string().optional(),
  fileName: z.string().optional(),
  downloadUrl: z.string().optional(),
})

type DownloadToWorkspaceFileArgs = z.infer<typeof DownloadToWorkspaceFileArgsSchema>
type DownloadToWorkspaceFileResult = z.infer<typeof DownloadToWorkspaceFileResultSchema>

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim()
}

function stripQueryAndHash(input: string): string {
  return input.split('#')[0]?.split('?')[0] ?? input
}

function extractFileNameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname
    const lastSegment = pathname.split('/').pop()
    if (!lastSegment) return undefined
    const decoded = decodeURIComponent(lastSegment)
    return decoded && decoded !== '/' ? decoded : undefined
  } catch {
    return undefined
  }
}

function extractFileNameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined

  const utf8Match = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim())
    } catch {
      return utf8Match[1].trim()
    }
  }

  const quotedMatch = header.match(/filename\s*=\s*"([^"]+)"/i)
  if (quotedMatch?.[1]) return quotedMatch[1].trim()

  const bareMatch = header.match(/filename\s*=\s*([^;]+)/i)
  if (bareMatch?.[1]) return bareMatch[1].trim()

  return undefined
}

function resolveMimeType(
  responseContentType: string | null,
  candidateFileName?: string,
  sourceUrl?: string
): string {
  const headerMime = responseContentType?.split(';')[0]?.trim().toLowerCase()
  if (headerMime && headerMime !== 'application/octet-stream') {
    return headerMime
  }

  const fileName = candidateFileName || extractFileNameFromUrl(sourceUrl || '')
  const ext = fileName ? getFileExtension(stripQueryAndHash(fileName)) : ''
  return ext ? getMimeTypeFromExtension(ext) : 'application/octet-stream'
}

function ensureFileExtension(fileName: string, mimeType: string): string {
  const ext = getFileExtension(stripQueryAndHash(fileName))
  if (ext) return fileName

  const inferredExt = getExtensionFromMimeType(mimeType)
  return inferredExt ? `${fileName}.${inferredExt}` : fileName
}

function inferOutputFileName(
  requestedFileName: string | undefined,
  headers: { get(name: string): string | null },
  url: string,
  mimeType: string
): string {
  const preferredName =
    requestedFileName ||
    extractFileNameFromContentDisposition(headers.get('content-disposition')) ||
    extractFileNameFromUrl(url) ||
    'downloaded-file'

  const sanitized = sanitizeFileName(stripQueryAndHash(preferredName)) || 'downloaded-file'
  return ensureFileExtension(sanitized, mimeType)
}

export const downloadToWorkspaceFileServerTool: BaseServerTool<
  DownloadToWorkspaceFileArgs,
  DownloadToWorkspaceFileResult
> = {
  name: 'download_to_workspace_file',
  inputSchema: DownloadToWorkspaceFileArgsSchema,
  outputSchema: DownloadToWorkspaceFileResultSchema,

  async execute(
    params: DownloadToWorkspaceFileArgs,
    context?: ServerToolContext
  ): Promise<DownloadToWorkspaceFileResult> {
    const reqLogger = logger.withMetadata({ messageId: context?.messageId })

    if (!context?.userId) {
      throw new Error('Authentication required')
    }

    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    try {
      assertServerToolNotAborted(context)

      // secureFetchWithValidation handles: DNS resolution, private IP blocking (via ipaddr.js),
      // SSRF-safe redirect following, and streaming size enforcement
      const response = await secureFetchWithValidation(params.url, {
        maxResponseBytes: MAX_DOWNLOAD_BYTES,
      })

      if (!response.ok) {
        return {
          success: false,
          message: `Download failed with status ${response.status} ${response.statusText}`,
        }
      }

      const mimeType = resolveMimeType(
        response.headers.get('content-type'),
        params.fileName,
        params.url
      )
      const fileName = inferOutputFileName(params.fileName, response.headers, params.url, mimeType)

      assertServerToolNotAborted(context)

      const arrayBuffer = await response.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)

      if (fileBuffer.length === 0) {
        return { success: false, message: 'Downloaded file is empty' }
      }

      assertServerToolNotAborted(context)
      const uploaded = await uploadWorkspaceFile(
        workspaceId,
        context.userId,
        fileBuffer,
        fileName,
        mimeType
      )

      reqLogger.info('Downloaded remote file to workspace', {
        sourceUrl: params.url,
        fileId: uploaded.id,
        fileName: uploaded.name,
        mimeType,
        size: fileBuffer.length,
      })

      return {
        success: true,
        message: `Downloaded "${uploaded.name}" to workspace (${fileBuffer.length} bytes)`,
        fileId: uploaded.id,
        fileName: uploaded.name,
        downloadUrl: uploaded.url,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      reqLogger.error('Failed to download file to workspace', {
        url: params.url,
        error: msg,
      })
      return { success: false, message: `Failed to download file: ${msg}` }
    }
  },
}
