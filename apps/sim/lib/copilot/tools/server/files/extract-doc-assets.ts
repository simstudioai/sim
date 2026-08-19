import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { messageForCopilotFileError } from '@/lib/copilot/auth/file-delegation'
import { ExtractDocAssets } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { extractDocAssets } from '@/lib/copilot/tools/server/files/doc-asset-extract'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import {
  createWorkspaceFileByPath,
  updateWorkspaceFileContentByPath,
} from '@/lib/workspace-files/application/write-workspace-file-by-path'

const logger = createLogger('ExtractDocAssetsTool')

const MAX_SOURCE_BYTES = 100 * 1024 * 1024 // 100 MB
const MAX_MEDIA_FILES = 200

const ExtractDocAssetsArgsSchema = z.object({
  path: z.string().min(1),
  destination: z.string().min(1).optional(),
})

const ExtractDocAssetsResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  themePath: z.string().optional(),
  theme: z.unknown().optional(),
  files: z
    .array(z.object({ fileId: z.string(), fileName: z.string(), vfsPath: z.string() }))
    .optional(),
})

type ExtractDocAssetsArgs = z.infer<typeof ExtractDocAssetsArgsSchema>
type ExtractDocAssetsResult = z.infer<typeof ExtractDocAssetsResultSchema>

/**
 * Materializes a reference document's design into workspace files with a
 * fixed, predictable structure: `<destination>/theme.json` (color scheme,
 * fonts, slide size) plus one file per embedded image, original bytes.
 * Re-running against the same destination overwrites the previous set
 * instead of duplicating it. The source document is never modified.
 */
export const extractDocAssetsServerTool: BaseServerTool<
  ExtractDocAssetsArgs,
  ExtractDocAssetsResult
> = {
  name: ExtractDocAssets.id,
  inputSchema: ExtractDocAssetsArgsSchema,
  outputSchema: ExtractDocAssetsResultSchema,

  async execute(
    params: ExtractDocAssetsArgs,
    context?: ServerToolContext
  ): Promise<ExtractDocAssetsResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    try {
      assertServerToolNotAborted(context)

      const record = await resolveCopilotWorkspaceFileReference(
        context,
        fileOperations.readContent,
        { workspaceId, reference: params.path }
      )
      const sourceName = record.name
      const ext = getFileExtension(sourceName).toLowerCase()
      if (ext !== 'pptx' && ext !== 'docx') {
        return {
          success: false,
          message: `"${sourceName}" is a .${ext || '?'} file — assets can only be extracted from .pptx or .docx documents`,
        }
      }

      const { content } = await executeCopilotFileUseCase(
        context,
        readWorkspaceFileContent,
        { fileId: record.id, assertedWorkspaceId: workspaceId, maxBytes: MAX_SOURCE_BYTES },
        { fileId: record.id }
      )

      assertServerToolNotAborted(context)
      const extracted = await extractDocAssets(content, ext)
      if (extracted.media.length > MAX_MEDIA_FILES) {
        extracted.media = extracted.media.slice(0, MAX_MEDIA_FILES)
      }

      const baseName = sourceName.replace(/\.[^.]+$/, '')
      const destination = (params.destination ?? `files/${baseName} assets`).replace(/\/+$/, '')

      // Overwrite-or-create per file: a re-run refreshes the set in place
      // rather than erroring on the existing files or duplicating them.
      const writeAsset = async (name: string, bytes: Buffer, contentType: string) => {
        const writeInput = {
          workspaceId,
          path: `${destination}/${name}`,
          content: bytes.toString('base64'),
          encoding: 'base64' as const,
          contentType,
        }
        try {
          return await executeCopilotFileUseCase(context, createWorkspaceFileByPath, {
            ...writeInput,
            mode: 'create' as const,
          })
        } catch {
          return await executeCopilotFileUseCase(context, updateWorkspaceFileContentByPath, {
            ...writeInput,
            mode: 'overwrite' as const,
          })
        }
      }

      const written: Array<{ fileId: string; fileName: string; vfsPath: string }> = []
      const themeFile = await writeAsset(
        'theme.json',
        Buffer.from(JSON.stringify(extracted.theme, null, 2), 'utf8'),
        'application/json'
      )
      written.push({ fileId: themeFile.id, fileName: themeFile.name, vfsPath: themeFile.vfsPath })

      for (const media of extracted.media) {
        assertServerToolNotAborted(context)
        const mediaExt = getFileExtension(media.name)
        const mime = mediaExt ? getMimeTypeFromExtension(mediaExt) : 'application/octet-stream'
        const file = await writeAsset(media.name, media.bytes, mime)
        written.push({ fileId: file.id, fileName: file.name, vfsPath: file.vfsPath })
      }

      logger.info('Extracted document assets to workspace', {
        source: params.path,
        destination,
        mediaCount: extracted.media.length,
        colorCount: Object.keys(extracted.theme.colors).length,
      })

      const themeSummary = [
        Object.keys(extracted.theme.colors).length > 0 ? 'theme colors' : null,
        extracted.theme.fonts.major || extracted.theme.fonts.minor ? 'fonts' : null,
        extracted.theme.slideSize ? 'slide size' : null,
      ]
        .filter(Boolean)
        .join(', ')
      return {
        success: true,
        message: `Extracted ${extracted.media.length} asset file(s) and theme.json (${themeSummary || 'no theme data found'}) from "${sourceName}" into ${destination}/`,
        themePath: written[0]?.vfsPath,
        theme: extracted.theme,
        files: written,
      }
    } catch (error) {
      const msg = getErrorMessage(error, 'Unknown error')
      logger.error('Failed to extract document assets', { path: params.path, error: msg })
      return {
        success: false,
        message: `Failed to extract assets: ${messageForCopilotFileError(error, 'Unable to extract document assets')}`,
      }
    }
  },
}
