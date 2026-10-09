import type { CursorKey } from '@/lib/api/list-query'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import {
  executeGrep,
  type GrepMaterialized,
  MAX_GREP_BYTES_PER_FILE,
  MAX_GREP_FILES,
  mapGrepFileReads,
  withGrepReadSlot,
} from '@/lib/mothership/agent-cli/engines/universal-grep'
import { importProjectFileProvenance } from '@/lib/mothership/agent-cli/project-file-provenance'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import type { AgentCliAugmentationInvocation } from '@/lib/mothership/generated/agent-cli'
import { listProjectFiles, readProjectFileArtifact } from '@/lib/projects/files/application'
import { parseWorkspaceFileText } from '@/lib/workspace-files/text-extraction'
import { workspaceFileTextFormat } from '@/lib/workspace-files/text-format'

/** Project grep materializes only freshly authorized files and imports evidence before matching. */
export function grepProjectFiles(
  invocation: AgentCliAugmentationInvocation,
  context: AgentCliExecutionContext,
  projectId: string
) {
  return executeGrep(invocation.positionals, invocation.flags, {
    signal: context.signal,
    allowedScopes: ['files'],
    async materialize(_scopes, nameFilter, reportIncomplete) {
      const selectedFiles: {
        item: Awaited<ReturnType<typeof listProjectFiles.execute>>['files'][number]
        label: string
      }[] = []
      const files: Awaited<ReturnType<typeof listProjectFiles.execute>>['files'] = []
      let after: CursorKey[] | undefined
      for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
        context.signal?.throwIfAborted()
        const page = await withGrepReadSlot(
          () =>
            executeCopilotProjectFileUseCase(
              context,
              listProjectFiles,
              { projectId, sortBy: 'name', sortOrder: 'asc', limit: 100, after },
              { projectId }
            ),
          context.signal
        )
        files.push(...page.files)
        if (!page.nextKeys) break
        after = page.nextKeys
        if (pageNumber === 49)
          reportIncomplete(
            'files: listing stopped after 50 pages; use files list to continue discovery.'
          )
      }
      let selected = 0
      for (const item of files) {
        context.signal?.throwIfAborted()
        const folder = (item.folderPath ?? '').replace(/^\/+|\/+$/g, '')
        const label = folder ? `${folder}/${item.name}` : item.name
        if (
          nameFilter &&
          item.id.toLowerCase() !== nameFilter &&
          !label.toLowerCase().includes(nameFilter)
        )
          continue
        if (selected++ >= MAX_GREP_FILES) {
          reportIncomplete(
            `files: searched the first ${MAX_GREP_FILES} selected files; narrow with --in files/<name-or-id>.`
          )
          break
        }
        selectedFiles.push({ item, label })
      }
      return mapGrepFileReads(selectedFiles, async ({ item, label }): Promise<GrepMaterialized> => {
        context.signal?.throwIfAborted()
        const target = { projectId, fileId: item.id }
        let artifact: Awaited<ReturnType<typeof readProjectFileArtifact.execute>>
        try {
          artifact = await withGrepReadSlot(
            () =>
              executeCopilotProjectFileUseCase(
                context,
                readProjectFileArtifact,
                { ...target, maxBytes: MAX_GREP_BYTES_PER_FILE },
                target
              ),
            context.signal
          )
        } catch {
          context.signal?.throwIfAborted()
          reportIncomplete(
            `files/${label} (${item.id}): could not read text; use files read to inspect the error.`
          )
          return { scope: 'files', id: item.id, label, text: null }
        }
        await importProjectFileProvenance(
          context.resolvedSecretTraceRegistry,
          artifact.secretProvenance
        )
        let text: string | null = null
        try {
          const format = workspaceFileTextFormat({
            name: artifact.file.name,
            type: artifact.contentType,
          })
          if (!format) throw new Error('No text decoder')
          const parsed = await parseWorkspaceFileText(artifact.buffer, format, {
            maxTextBytes: MAX_GREP_BYTES_PER_FILE,
            signal: context.signal,
          })
          if (parsed.metadata?.degraded || parsed.metadata?.truncated)
            reportIncomplete(
              `files/${label} (${item.id}): text extraction is incomplete; use files read to inspect it.`
            )
          if (!parsed.metadata?.degraded) text = parsed.content
        } catch {
          context.signal?.throwIfAborted()
          reportIncomplete(
            `files/${label} (${item.id}): could not decode text; use files read to inspect the error.`
          )
        }
        return { scope: 'files', id: item.id, label, text }
      })
    },
  })
}
