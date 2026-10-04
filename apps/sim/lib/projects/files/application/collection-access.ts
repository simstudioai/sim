import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

/** Collection subscribers use current Project read policy without receiving any file authority. */
export const getProjectFileListAccess = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.observeCollection,
  async execute({ context }) {
    return { projectId: context.projectId, canRead: true as const }
  },
})
