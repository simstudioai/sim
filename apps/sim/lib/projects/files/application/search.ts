import { getPostgresErrorCode } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { listProjectFileFolders } from '@/lib/projects/files/application/folders'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { listFileFolders } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
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

export interface SearchProjectFileContentInput
  extends Omit<SearchWorkspaceFileContentInput, 'workspaceId'> {
  projectId: string
}

export const searchProjectFileContent = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.searchContent,
  SearchProjectFileContentInput,
  FileSearchResult & { secretProvenance: WorkspaceFileSecretProvenance },
  FileSearchResult
>({
  operation: projectFileOperations.searchContent,
  async prepare({ input, principal, context, request }) {
    const signal = input.signal ?? request?.signal
    signal?.throwIfAborted()
    const folders =
      input.folderPaths === undefined
        ? []
        : (
            await listProjectFileFolders.execute({
              principal,
              input: { projectId: context.projectId },
            })
          ).folders
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
  async execute({ tx, input, context, prepared, request }) {
    if (!prepared) throw new Error('Search snapshot is missing')
    try {
      const folders =
        input.folderPaths === undefined ? [] : await listFileFolders(context.owner, {}, tx)
      const secretProvenance = await loadFileSearchDelivery(tx, {
        owner: context.owner,
        prepared,
        scope: resolveFileSearchFolderScope(folders, input),
        signal: input.signal ?? request?.signal,
      })
      return { ...prepared, secretProvenance }
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
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
})
