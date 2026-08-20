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
import { extractPdfAssets } from '@/lib/copilot/tools/server/files/doc-asset-extract-pdf'
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
 * fonts, slide size), `<destination>/layout.json` (the slide/page-by-page
 * text and asset layout, pptx and pdf), plus one file per embedded image —
 * original bytes for OOXML media; for PDF, an image stored as base +
 * separate alpha mask is recombined into a transparent PNG.
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
      if (ext !== 'pptx' && ext !== 'docx' && ext !== 'pdf') {
        return {
          success: false,
          message: `"${sourceName}" is a .${ext || '?'} file — assets can only be extracted from .pptx, .docx, or .pdf documents`,
        }
      }

      const { content } = await executeCopilotFileUseCase(
        context,
        readWorkspaceFileContent,
        { fileId: record.id, assertedWorkspaceId: workspaceId, maxBytes: MAX_SOURCE_BYTES },
        { fileId: record.id }
      )

      assertServerToolNotAborted(context)
      // OOXML is a zip and extracts in-process; PDF needs the doc sandbox's
      // poppler/pdfplumber toolchain (same environment that compiles docs).
      const extracted =
        ext === 'pdf' ? await extractPdfAssets(content) : await extractDocAssets(content, ext)
      const totalMediaCount = extracted.media.length
      if (totalMediaCount > MAX_MEDIA_FILES) {
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

      // The slide/page-by-page rebuild recipe — text blocks with their frame,
      // font, size, and color, plus each slide's asset placements by extracted
      // filename (pdf pages also carry filled rects and overlay scrims).
      let wroteLayout = false
      if (extracted.layout.length > 0) {
        const layoutFile = await writeAsset(
          'layout.json',
          Buffer.from(JSON.stringify(extracted.layout, null, 2), 'utf8'),
          'application/json'
        )
        written.push({
          fileId: layoutFile.id,
          fileName: layoutFile.name,
          vfsPath: layoutFile.vfsPath,
        })
        wroteLayout = true
      }

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
        droppedMediaCount: totalMediaCount - extracted.media.length,
        format: extracted.theme.format,
      })

      const themeSummary = (
        extracted.theme.format === 'pdf'
          ? [
              extracted.theme.fonts.length > 0 ? 'font names' : null,
              extracted.theme.inferredPalette.length > 0 ? 'inferred palette' : null,
              'page size and image placements',
            ]
          : [
              Object.keys(extracted.theme.colors).length > 0 ? 'theme colors' : null,
              extracted.theme.fonts.major || extracted.theme.fonts.minor ? 'fonts' : null,
              extracted.theme.slideSize ? 'slide size' : null,
            ]
      )
        .filter(Boolean)
        .join(', ')
      const unit = extracted.theme.format === 'pdf' ? 'page' : 'slide'
      const layoutNote = wroteLayout
        ? `, plus layout.json (${unit}-by-${unit} text and asset layout)`
        : ''
      // Never report a truncated set as complete: theme/layout may reference
      // media that was not written.
      const truncationNote =
        totalMediaCount > extracted.media.length
          ? ` NOTE: the document holds ${totalMediaCount} media files; only the first ${extracted.media.length} were extracted — theme/layout references beyond that were not written.`
          : ''
      return {
        success: true,
        message: `Extracted ${extracted.media.length} asset file(s) and theme.json (${themeSummary || 'no theme data found'})${layoutNote} from "${sourceName}" into ${destination}/${truncationNote}`,
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
