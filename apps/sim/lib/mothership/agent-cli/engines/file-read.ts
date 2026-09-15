import { v2ReadFileTextContract, v2ReadFileTextQuerySchema } from '@/lib/api/contracts/v2/files'
import { fileReadFailure, readFileVisual } from '@/lib/mothership/agent-cli/engines/file-view'
import { observePrivateFile } from '@/lib/mothership/agent-cli/engines/observe-private-file'
import { readScratchFile } from '@/lib/mothership/agent-cli/engines/scratch-file-read'
import { type AgentCliEngine, agentCliFail, agentCliOk } from '@/lib/mothership/agent-cli/types'
import { readChatAttachment } from '@/lib/mothership/chat/application/read-attachment'
import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  needsRenderedArtifact,
  resolveEffectiveMimeType,
} from '@/lib/uploads/utils/file-utils'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import { workspaceFileTextFormat } from '@/lib/workspace-files/text-format'

/** One agent read selects the usable representation after canonical authorization. */
export const fileReadCommand: AgentCliEngine = {
  openReadResources: true,
  async execute(positionals, runtime, flags) {
    const reference = positionals[0]
    if (!reference)
      return agentCliFail(
        'files read requires a workspace file reference or absolute sandbox path.'
      )
    if (!runtime.principal)
      return agentCliFail('Workspace authentication is unavailable. Retry the read.')
    for (const key of ['max-bytes', 'offset', 'limit']) {
      if (flags[key] === true) return agentCliFail(`--${key} requires a value.`)
    }
    if (flags.render !== undefined && flags.render !== true)
      return agentCliFail('--render is a flag without a value.')
    if (flags.pages !== undefined && (typeof flags.pages !== 'string' || !flags.pages.trim()))
      return agentCliFail('--pages requires a page number or range.')
    const textRange = flags.offset !== undefined || flags.limit !== undefined
    const visual = flags.render !== undefined || flags.pages !== undefined
    if (textRange && visual)
      return agentCliFail('Use text line ranges or visual page options in one read, not both.')
    const query = v2ReadFileTextQuerySchema.safeParse({
      workspaceId: runtime.workspaceId,
      ...(flags['max-bytes'] !== undefined ? { maxBytes: flags['max-bytes'] } : {}),
      ...(flags.offset !== undefined ? { offset: flags.offset } : {}),
      ...(flags.limit !== undefined ? { limit: flags.limit } : {}),
    })
    if (!query.success)
      return agentCliFail(query.error.issues.map((issue) => issue.message).join('; '))
    runtime.signal?.throwIfAborted()
    try {
      if (reference.startsWith('/tmp/') || reference.startsWith('/home/user/'))
        return await readScratchFile(reference, runtime, flags, query.data)
      if (
        runtime.chatOrganizationId &&
        runtime.chatId &&
        runtime.chatPrincipal &&
        reference.startsWith('uploads/')
      ) {
        const attachment = await readChatAttachment.execute({
          principal: runtime.chatPrincipal,
          input: {
            chatId: runtime.chatId,
            reference,
            maxBytes: query.data.maxBytes,
            signal: runtime.signal,
          },
        })
        return observePrivateFile(
          { ...attachment, path: reference, source: 'upload' },
          flags,
          query.data,
          runtime.signal
        )
      }
      const file = await resolveWorkspaceFileReference({
        principal: runtime.principal,
        operation: fileOperations.readContent,
        workspaceId: runtime.workspaceId,
        reference,
        ...(runtime.chatId !== undefined ? { chatId: runtime.chatId } : {}),
      })
      runtime.signal?.throwIfAborted()
      const type =
        (needsRenderedArtifact(file.type, file.name)
          ? getMimeTypeFromExtension(getFileExtension(file.name))
          : resolveEffectiveMimeType(file.type, file.name)
        )
          .split(';')[0]
          ?.trim()
          .toLowerCase() ?? ''
      if (visual || (!textRange && (type.startsWith('image/') || type === 'application/pdf'))) {
        const { metadata, ...result } = await readFileVisual(
          file.id,
          runtime,
          flags,
          query.data.maxBytes
        )
        return {
          ...result,
          stdout: JSON.stringify({ ...metadata, representation: 'visual' }),
        }
      }
      if (workspaceFileTextFormat(file)) {
        const path = v2ReadFileTextContract.path.replace('[fileId]', encodeURIComponent(file.id))
        const params: Record<string, string> = { workspaceId: runtime.workspaceId }
        for (const key of ['maxBytes', 'offset', 'limit'] as const) {
          const value = query.data[key]
          if (value !== undefined) params[key] = String(value)
        }
        /** The embedded transport imports revision-bound secret provenance before exposing text. */
        const { data } = v2ReadFileTextContract.response.schema.parse(
          await runtime.client.request(path, { query: params })
        )
        runtime.signal?.throwIfAborted()
        return agentCliOk(JSON.stringify({ ...data, representation: 'text' }))
      }
      if (textRange)
        return agentCliFail(
          'This file has no text decoder. Omit the line range to read its available representation.'
        )
      return {
        ...agentCliOk(
          JSON.stringify({
            fileId: file.id,
            name: file.name,
            path: workspaceFileVfsPath(file),
            type: file.type,
            representation: 'binary',
            bytes: file.size,
            contentAvailable: false,
            note: 'Content was not inspected: this file has no model-readable decoder. Mount its path using run_code inputs.files[].path to process the original bytes.',
          })
        ),
        resources: [
          {
            op: 'upsert',
            readOnly: true,
            resource: { type: 'file', id: file.id, title: file.name },
          },
        ],
      }
    } catch (error) {
      return fileReadFailure(error)
    }
  },
}
