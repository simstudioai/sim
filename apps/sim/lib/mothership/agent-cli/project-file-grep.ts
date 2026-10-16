import type { CursorKey } from '@/lib/api/list-query'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import {
  executeGrep,
  type GrepMaterialized,
  grepListingStoppedMessage,
  MAX_GREP_BYTES_PER_FILE,
  MAX_GREP_FILES,
  MAX_GREP_LIST_PAGES,
  mapGrepFileReads,
  withGrepReadSlot,
} from '@/lib/mothership/agent-cli/engines/universal-grep'
import { admitProjectFileProvenance } from '@/lib/mothership/agent-cli/project-file-provenance'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import type { AgentCliAugmentationInvocation } from '@/lib/mothership/generated/agent-cli'
import { listProjectFiles, readProjectFileText } from '@/lib/projects/files/application'

/** Project grep materializes only freshly authorized files and imports evidence before matching. */
export function grepProjectFiles(
  invocation: AgentCliAugmentationInvocation,
  context: AgentCliExecutionContext,
  projectId: string
) {
  /** Files are a Project's only grep scope, so an omitted scope means files. */
  const flags =
    invocation.flags.scope === undefined
      ? { ...invocation.flags, scope: 'files' }
      : invocation.flags
  return executeGrep(invocation.positionals, flags, {
    signal: context.signal,
    registry: context.resolvedSecretTraceRegistry,
    scopeLimit: {
      scopes: ['files'],
      refusal: 'Project grep supports only --scope files. Search workspace resources separately.',
    },
    async materialize(_scopes, nameFilter, reportIncomplete) {
      const selectedFiles: {
        item: Awaited<ReturnType<typeof listProjectFiles.execute>>['files'][number]
        label: string
      }[] = []
      let after: CursorKey[] | undefined
      /** Selection runs per page so a full file budget stops the inventory walk. */
      inventory: for (let pageNumber = 0; pageNumber < MAX_GREP_LIST_PAGES; pageNumber++) {
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
        for (const item of page.files) {
          const folder = (item.folderPath ?? '').replace(/^\/+|\/+$/g, '')
          const label = folder ? `${folder}/${item.name}` : item.name
          if (
            nameFilter &&
            item.id.toLowerCase() !== nameFilter &&
            !label.toLowerCase().includes(nameFilter)
          )
            continue
          if (selectedFiles.length >= MAX_GREP_FILES) {
            reportIncomplete(
              `files: searched the first ${MAX_GREP_FILES} selected files; narrow with --in files/<name-or-id>.`
            )
            break inventory
          }
          selectedFiles.push({ item, label })
        }
        if (!page.nextKeys) break
        after = page.nextKeys
        if (pageNumber === MAX_GREP_LIST_PAGES - 1)
          reportIncomplete(grepListingStoppedMessage('files'))
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
                { ...target, maxBytes: MAX_GREP_BYTES_PER_FILE, skipFolderPath: true },
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
        if (
          !(await admitProjectFileProvenance(
            context.resolvedSecretTraceRegistry,
            read.secretProvenance
          ))
        ) {
          reportIncomplete(
            `files/${label} (${item.id}): text withheld without its secret provenance; use files read to inspect it.`
          )
          return { scope: 'files', id: item.id, label, text: null }
        }
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
