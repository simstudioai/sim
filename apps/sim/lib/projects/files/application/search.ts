import { getPostgresErrorCode } from '@sim/utils/errors'
import { admitEach, mustClassifyContent } from '@/lib/core/application/content-delivery'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { listFileFolders } from '@/lib/uploads/contexts/workspace'
import { mergeWorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import {
  hasWorkspaceFileDeliveryObserver,
  reportWorkspaceFileDelivery,
} from '@/lib/workspace-files/application/file-delivery-observer'
import type { SearchWorkspaceFileContentInput } from '@/lib/workspace-files/application/search-workspace-file-content'
import {
  loadFileSearchDelivery,
  resolveFileSearchFolderScope,
} from '@/lib/workspace-files/search/delivery'
import { WorkspaceFileSearchUnavailableError } from '@/lib/workspace-files/search/errors'
import {
  compileFileSearchPattern,
  FileSearchPatternError,
} from '@/lib/workspace-files/search/pattern'
import { type FileSearchResult, searchFileIndex } from '@/lib/workspace-files/search/repository'

interface SearchProjectFileContentInput
  extends Omit<SearchWorkspaceFileContentInput, 'workspaceId'> {
  projectId: string
}

/** Searches the index, then validates the snapshot against current rows under Project authority. */
const snapshotSearch = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.searchContent,
  SearchProjectFileContentInput,
  { prepared: FileSearchResult; delivery: Awaited<ReturnType<typeof loadFileSearchDelivery>> },
  FileSearchResult
>({
  operation: projectFileOperations.searchContent,
  isolationLevel: 'repeatable read',
  async prepare({ input, context, request }) {
    const signal = input.signal ?? request?.signal
    signal?.throwIfAborted()
    const folders = input.folderPaths === undefined ? [] : await listFileFolders(context.owner)
    try {
      return await searchFileIndex({
        owner: context.owner,
        pattern: compileFileSearchPattern(input.query, input.mode),
        maxResults: input.maxResults,
        folderScope: resolveFileSearchFolderScope(folders, input),
        signal,
      })
    } catch (error) {
      if (error instanceof FileSearchPatternError)
        throw new OrchestrationError('validation', error.message)
      if (error instanceof WorkspaceFileSearchUnavailableError)
        throw new OrchestrationError('locked', error.message)
      throw error
    }
  },
  async execute({ tx, input, context, prepared, request, principal }) {
    if (!prepared) throw new Error('Search snapshot is missing')
    try {
      const folders =
        input.folderPaths === undefined ? [] : await listFileFolders(context.owner, {}, tx)
      const delivery = await loadFileSearchDelivery(tx, {
        owner: context.owner,
        classify: mustClassifyContent(principal) || hasWorkspaceFileDeliveryObserver(),
        prepared,
        scope: resolveFileSearchFolderScope(folders, input),
        signal: input.signal ?? request?.signal,
      })
      return { prepared, delivery }
    } catch (error) {
      if (['55P03', '25P04'].includes(getPostgresErrorCode(error) ?? '')) {
        throw new OrchestrationError(
          'locked',
          'File search is briefly unavailable. Try again shortly.'
        )
      }
      throw error
    }
  },
})

/** Admission runs after the snapshot commits, as on every Project read; row and Project locks would fence nothing. */
export const searchProjectFileContent = {
  operation: snapshotSearch.operation,
  delegationAudience: snapshotSearch.delegationAudience,
  authorize: snapshotSearch.authorize,
  async execute(args: Parameters<typeof snapshotSearch.execute>[0]): Promise<FileSearchResult> {
    const { prepared, delivery } = await snapshotSearch.execute(args)
    const provenanceOf = (fileId: string) =>
      delivery.provenance.get(fileId) ?? { status: 'unknown' as const }
    const current = prepared.sources.filter((source) =>
      delivery.current.has(source.identity.fileId)
    )
    const admitted = await admitEach(args.principal, current, async (sources) =>
      sources.map((source) => ({
        kind: 'workspace-file' as const,
        id: source.identity.fileId,
        provenance: provenanceOf(source.identity.fileId),
        view: 'excerpt' as const,
      }))
    )
    const admittedIds = new Set(admitted.map((source) => source.identity.fileId))
    const results = prepared.results
      .filter((hit) => !delivery.outOfScope.has(hit.fileId))
      .map((hit) =>
        admittedIds.has(hit.fileId)
          ? hit
          : {
              ...hit,
              text: '[Preview withheld: read or grep this file to inspect protected text.]',
            }
      )
    await reportWorkspaceFileDelivery(
      mergeWorkspaceFileSecretProvenance(
        ...admitted.map((source) => provenanceOf(source.identity.fileId))
      )
    )
    return { ...prepared, results, count: results.length, sources: admitted }
  },
}
