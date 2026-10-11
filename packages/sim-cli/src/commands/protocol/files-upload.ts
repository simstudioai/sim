import type { Command } from 'commander'
import type {
  CompleteFileUploadResponse,
  CompleteProjectFileUploadResponse,
  CreateFileUploadResponse,
  CreateProjectFileUploadResponse,
} from '../../generated/v2-api'
import { apiCommand, type Connection } from '../../runtime/called-operations'
import { encodeFolderPath } from '../../runtime/request'
import { contentTypeFor, localFile } from '../../transfer/local-file'
import { finishUploadSession } from '../../transfer/upload-session'
import { printProtocolResult } from './result'

interface FileUploadOptions {
  folder?: string
  name?: string
}

const WORKSPACE_UPLOAD_OPERATIONS = [
  'createFileUpload',
  'createFileUploadPartUrls',
  'completeFileUpload',
  'abortFileUpload',
] as const
const PROJECT_UPLOAD_OPERATIONS = [
  'createProjectFileUpload',
  'getProjectFileUploadPartUrls',
  'completeProjectFileUpload',
  'abortProjectFileUpload',
] as const

type UploadOperation =
  | (typeof WORKSPACE_UPLOAD_OPERATIONS)[number]
  | (typeof PROJECT_UPLOAD_OPERATIONS)[number]

async function uploadFile<Operation extends UploadOperation>(
  connect: () => Connection<Operation>,
  path: string,
  options: FileUploadOptions,
  operations: readonly [Operation, Operation, Operation, Operation],
  projectId?: string
): Promise<void> {
  const { client, profile } = connect()
  const workspaceId = projectId ? undefined : client.requireWorkspace()
  const { name, size } = await localFile(path, options.name)
  const created = await client.request<CreateFileUploadResponse | CreateProjectFileUploadResponse>(
    operations[0],
    {
      params: projectId ? { projectId } : undefined,
      body: {
        ...(workspaceId ? { workspaceId } : {}),
        name,
        contentType: contentTypeFor(name),
        size,
        ...(options.folder !== undefined ? { folderPath: encodeFolderPath(options.folder) } : {}),
      },
    }
  )
  const { session, uploadToken, transfer } = created.data
  const completed: CompleteFileUploadResponse['data'] | CompleteProjectFileUploadResponse['data'] =
    await finishUploadSession(
      client,
      workspaceId,
      {
        operations: { parts: operations[1], complete: operations[2], abort: operations[3] },
        params: { uploadId: session.id, ...(projectId ? { projectId } : {}) },
        uploadToken,
        transfer,
        size,
      },
      path
    )
  if (!completed.file) throw new Error(`File upload ${session.id} completed without a file`)
  printProtocolResult(profile.output, completed.file)
}

export function attachFileUpload(files: Command): void {
  const [upload, connect] = apiCommand(files, 'upload', WORKSPACE_UPLOAD_OPERATIONS)
  upload
    .argument('<path>', 'Local file to upload')
    .allowExcessArguments(false)
    .description('Upload a file to the workspace')
    .option('--folder <path>', 'Folder path as shown in the app; defaults to the root folder')
    .option('--name <name>', 'Store it under a different name')
    .action((path: string, options: FileUploadOptions) =>
      uploadFile(connect, path, options, WORKSPACE_UPLOAD_OPERATIONS)
    )
}

export function attachProjectFileUpload(files: Command): void {
  const [upload, connect] = apiCommand(files, 'upload', PROJECT_UPLOAD_OPERATIONS)
  upload
    .argument('<projectId>', 'Project that will own the file')
    .argument('<path>', 'Local file to upload')
    .allowExcessArguments(false)
    .description('Upload a shared Project file')
    .option('--folder <path>', 'Folder path as shown in the app; defaults to the Project root')
    .option('--name <name>', 'Store it under a different name')
    .action((projectId: string, path: string, options: FileUploadOptions) =>
      uploadFile(connect, path, options, PROJECT_UPLOAD_OPERATIONS, projectId)
    )
}
