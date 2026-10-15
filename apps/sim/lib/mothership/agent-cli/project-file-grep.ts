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
import { listProjectFiles, readProjectFileText } from '@/lib/projects/files/application'

/** Project grep materializes only freshly authorized files and imports evidence before matching. */
export function grepProjectFiles(
  invocation: AgentCliAugmentationInvocation,
  context: AgentCliExecutionContext,
  projectId: string
) {
  return executeGrep(invocation.positionals, invocation.flags, {
    signal: context.signal,
    registry: context.resolvedSecretTraceRegistry,
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
        let read: Awaited<ReturnType<typeof readProjectFileText.execute>>
        try {
          read = await withGrepReadSlot(
            () =>
              executeCopilotProjectFileUseCase(
                context,
                readProjectFileText,
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
          read.secretProvenance
        )
        if (read.degraded || read.truncated) {
          reportIncomplete(
            `files/${label} (${item.id}): text extraction is ${read.degraded ? 'degraded' : 'truncated'}; use files read or files get to inspect it.`
          )
        }
        return { scope: 'files', id: item.id, label, text: read.degraded ? null : read.text }
      })
    },
  })
}
