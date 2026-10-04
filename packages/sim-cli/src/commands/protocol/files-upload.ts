import type { Command } from 'commander'
import { clientFrom } from '../../context'
import type {
  CompleteFileUploadResponse,
  CompleteProjectFileUploadResponse,
  CreateFileUploadResponse,
  CreateProjectFileUploadResponse,
} from '../../generated/v2-api'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { encodeFolderPath } from '../../runtime/request'
import { contentTypeFor, localFile } from '../../transfer/local-file'
import { finishUploadSession } from '../../transfer/upload-session'
import { printProtocolResult } from './result'

interface FileUploadOptions {
  folder?: string
  name?: string
}

type FileUploadOwner =
  | { entityType: 'workspace'; entityId: string }
  | { entityType: 'project'; entityId: string }

/** Both owners share transfer, cancellation and streaming; each carries its own control address. */
async function uploadFile(
  command: Command,
  path: string,
  options: FileUploadOptions,
  owner: FileUploadOwner
): Promise<void> {
  const { client, profile } = clientFrom(command)
  const { name, size } = await localFile(path, options.name)
  const basePath =
    owner.entityType === 'workspace'
      ? V2_OPERATIONS.createFileUpload.path
      : `/api/v2/projects/${encodeURIComponent(owner.entityId)}/files/uploads`
  const created = await client.request<CreateFileUploadResponse | CreateProjectFileUploadResponse>(
    basePath,
    {
      method: 'POST',
      body: {
        ...(owner.entityType === 'workspace' ? { workspaceId: owner.entityId } : {}),
        name,
        contentType: contentTypeFor(name),
        size,
        ...(options.folder !== undefined ? { folderPath: encodeFolderPath(options.folder) } : {}),
      },
    }
  )
  const { session, uploadToken, transfer } = created.data
  const completed = await finishUploadSession<
    CompleteFileUploadResponse['data'] | CompleteProjectFileUploadResponse['data']
  >(
    client,
    {
      basePath: `${basePath}/${encodeURIComponent(session.id)}`,
      ...(owner.entityType === 'workspace' ? { query: { workspaceId: owner.entityId } } : {}),
      uploadToken,
      transfer,
      size,
    },
    path
  )
  if (!completed.file) throw new Error(`File upload ${session.id} completed without a file`)
  /** Session credentials never belong in retained CLI output. */
  printProtocolResult(profile.output, completed.file)
}

export function attachFileUpload(files: Command): void {
  files
    .command('upload')
    .argument('<path>', 'Local file to upload')
    .allowExcessArguments(false)
    .description('Upload a file to the workspace')
    .option('--folder <path>', 'Folder path as shown in the app; defaults to the root folder')
    .option('--name <name>', 'Store it under a different name')
    .action(async (path: string, options: FileUploadOptions, command: Command) => {
      const { client } = clientFrom(command)
      await uploadFile(command, path, options, {
        entityType: 'workspace',
        entityId: client.requireWorkspace(),
      })
    })
}

export function attachProjectFileUpload(files: Command): void {
  files
    .command('upload')
    .argument('<projectId>', 'Project that will own the file')
    .argument('<path>', 'Local file to upload')
    .allowExcessArguments(false)
    .description('Upload a shared Project file')
    .option('--folder <path>', 'Folder path as shown in the app; defaults to the Project root')
    .option('--name <name>', 'Store it under a different name')
    .action(
      async (projectId: string, path: string, options: FileUploadOptions, command: Command) => {
        await uploadFile(command, path, options, { entityType: 'project', entityId: projectId })
      }
    )
}
