import {
  createProjectFileFolderContract,
  listProjectFileFoldersContract,
} from '@/lib/api/contracts/project-file-folders'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  createProjectFileFolder,
  listProjectFileFolders,
  projectFileOperations,
} from '@/lib/projects/files/application'

export const GET = defineInternalJsonRoute({
  contract: listProjectFileFoldersContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.listFolders,
  rateLimit: internalRateLimits.user({ bucketName: 'project-file-folders.read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ projectId: params.id, scope: query.scope }),
  useCase: listProjectFileFolders,
  present: (result) => result,
})

export const POST = defineInternalJsonRoute({
  contract: createProjectFileFolderContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.createFolder,
  rateLimit: internalRateLimits.user({ bucketName: 'project-file-folders.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, ...body }),
  useCase: createProjectFileFolder,
  present: (result) => result,
})
