import { ContentRefusedError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliFlags } from '@/lib/mothership/agent-cli/types'
import { agentCliOk } from '@/lib/mothership/agent-cli/types'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file'
import {
  type ExtractedFileText,
  extractFileTextFromBytes,
} from '@/lib/workspace-files/application/read-workspace-file-text'
import { decodeFileVisual } from '@/lib/workspace-files/decode-file-visual'
import { workspaceFileTextFormat } from '@/lib/workspace-files/text-format'

/** Images and PDFs are read visually unless a line range asks for their text. */
export function isDefaultVisualMediaType(type: string): boolean {
  return type.startsWith('image/') || type === 'application/pdf'
}

/** Shared representation selection for authorized private file bytes. */
export async function observePrivateFile(
  file: {
    buffer: Buffer
    name: string
    path: string
    source: 'sandbox' | 'upload' | 'knowledge' | 'project'
    fileId?: string
    contentType?: string
    /** The bytes hold secrets whose text redaction a rendered image would bypass. */
    hasRecordedSecrets?: boolean
    knowledge?: {
      documentId: string
      knowledgeBaseId: string
      processingStatus: string
      indexReady: boolean
      sourceAvailable: boolean
    }
  },
  flags: AgentCliFlags,
  options: { offset?: number; limit?: number; visual?: boolean },
  signal?: AbortSignal
) {
  const type = file.contentType ?? getMimeTypeFromExtension(getFileExtension(file.name))
  const metadata = {
    name: file.name,
    path: file.path,
    type,
    source: file.source,
    ...(file.fileId ? { fileId: file.fileId } : {}),
    ...file.knowledge,
  }
  const textRange = options.offset !== undefined || options.limit !== undefined
  const visual = options.visual || flags.render !== undefined || flags.pages !== undefined
  if (visual || (!textRange && isDefaultVisualMediaType(type))) {
    if (file.hasRecordedSecrets) {
      throw new ContentRefusedError('workspace-file')
    }
    const decoded = await decodeFileVisual({
      buffer: file.buffer,
      name: file.name,
      type,
      pages: typeof flags.pages === 'string' ? flags.pages : undefined,
      render: flags.render === true,
      signal: signal,
    })
    return {
      ...agentCliOk(
        JSON.stringify({
          ...metadata,
          representation: 'visual',
          mediaType: decoded.mediaType,
          bytes: decoded.buffer.length,
          truncated: decoded.truncated,
          ...(decoded.pages ? { pages: decoded.pages } : {}),
        })
      ),
      observations: [
        {
          name: file.name,
          ...(file.fileId ? { resourceId: file.fileId } : {}),
          mediaType: decoded.mediaType,
          data: decoded.buffer.toString('base64'),
          ...(decoded.pages ? { pageCount: decoded.pages.last - decoded.pages.first + 1 } : {}),
        },
      ],
    }
  }
  const format = workspaceFileTextFormat({ name: file.name, type })
  if (format) {
    const extracted = await extractFileTextFromBytes(file.buffer, format, file.name, options, {
      kind: file.source === 'knowledge' ? 'knowledge-document' : 'workspace-file',
    })
    return presentObservedText(metadata, extracted)
  }
  if (textRange) throw new OrchestrationError('validation', 'This file has no text decoder')
  return agentCliOk(
    JSON.stringify({
      ...metadata,
      representation: 'binary',
      bytes: file.buffer.length,
      contentAvailable: false,
      note:
        file.source === 'project'
          ? 'Content was not inspected: this file has no model-readable decoder. Download its stored bytes to inspect it.'
          : file.source === 'knowledge'
            ? 'Content was not inspected: this original has no model-readable decoder.'
            : 'Content was not inspected: this file has no model-readable decoder. Process its mounted sandbox path with run_code.',
    })
  )
}

/** The `files read` text representation, shared by every owner's text read. */
export function presentObservedText(
  metadata: Record<string, unknown>,
  extracted: ExtractedFileText
) {
  return agentCliOk(
    JSON.stringify({
      ...metadata,
      representation: 'text',
      text: extracted.text,
      truncated: extracted.truncated,
      degraded: extracted.degraded,
      degradedReason: extracted.degradedReason,
      charCount: extracted.text.length,
      byteCount: extracted.byteCount,
      ...(extracted.lineRange ? { lineRange: extracted.lineRange } : {}),
    })
  )
}
