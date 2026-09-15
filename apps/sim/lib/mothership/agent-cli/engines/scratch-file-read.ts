import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliFlags, AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { agentCliOk } from '@/lib/mothership/agent-cli/types'
import { readChatSandboxFile } from '@/lib/mothership/chat/application/read-sandbox-file'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  parseFileText,
  sliceTextLines,
} from '@/lib/workspace-files/application/read-workspace-file-text'
import { decodeFileVisual } from '@/lib/workspace-files/decode-file-visual'
import { workspaceFileTextFormat } from '@/lib/workspace-files/text-format'

/** The authorized scratch snapshot never becomes a workspace file or resource-panel entry. */
export async function readScratchFile(
  reference: string,
  runtime: AgentCliRuntime,
  flags: AgentCliFlags,
  options: { maxBytes?: number; offset?: number; limit?: number }
) {
  if (!runtime.principal || !runtime.chatId)
    throw new OrchestrationError('unauthorized', 'Scratch reads require an authenticated chat')
  const file = await readChatSandboxFile.execute({
    principal: runtime.principal,
    input: {
      chatId: runtime.chatId,
      workspaceId: runtime.workspaceId,
      path: reference,
      maxBytes: options.maxBytes,
      signal: runtime.signal,
    },
  })
  const type = getMimeTypeFromExtension(getFileExtension(file.name))
  const metadata = { name: file.name, path: file.path, type, source: 'sandbox' as const }
  const textRange = options.offset !== undefined || options.limit !== undefined
  const visual = flags.render !== undefined || flags.pages !== undefined
  if (visual || (!textRange && (type.startsWith('image/') || type === 'application/pdf'))) {
    const decoded = await decodeFileVisual({
      buffer: file.buffer,
      name: file.name,
      type,
      pages: typeof flags.pages === 'string' ? flags.pages : undefined,
      render: flags.render === true,
      signal: runtime.signal,
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
          mediaType: decoded.mediaType,
          data: decoded.buffer.toString('base64'),
          ...(decoded.pages ? { pageCount: decoded.pages.last - decoded.pages.first + 1 } : {}),
        },
      ],
    }
  }
  const format = workspaceFileTextFormat({ name: file.name, type })
  if (format) {
    const parsed = await parseFileText(file.buffer, format, file.name)
    const truncated = parsed.metadata?.truncated === true
    const { text, lineRange } = sliceTextLines(
      parsed.content,
      options.offset,
      options.limit,
      truncated
    )
    return agentCliOk(
      JSON.stringify({
        ...metadata,
        representation: 'text',
        text,
        truncated,
        degraded: parsed.metadata?.degraded === true,
        degradedReason:
          parsed.metadata?.degraded === true ? (parsed.metadata.warning ?? null) : null,
        charCount: text.length,
        byteCount: file.buffer.length,
        ...(lineRange ? { lineRange } : {}),
      })
    )
  }
  if (textRange) throw new OrchestrationError('validation', 'This scratch file has no text decoder')
  return agentCliOk(
    JSON.stringify({
      ...metadata,
      representation: 'binary',
      bytes: file.buffer.length,
      contentAvailable: false,
      note: 'Content was not inspected: this file has no model-readable decoder. Process its sandbox path with run_code.',
    })
  )
}
