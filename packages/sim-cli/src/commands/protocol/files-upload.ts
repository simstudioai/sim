import type { Command } from 'commander'
import type { CompleteFileUploadResponse, CreateFileUploadResponse } from '../../generated/v2-api'
import { apiCommand } from '../../runtime/called-operations'
import { encodeFolderPath } from '../../runtime/request'
import { contentTypeFor, localFile } from '../../transfer/local-file'
import { finishUploadSession } from '../../transfer/upload-session'
import { printProtocolResult } from './result'

export function attachFileUpload(files: Command): void {
  const [upload, connectUpload] = apiCommand(files, 'upload', [
    'createFileUpload',
    'createFileUploadPartUrls',
    'completeFileUpload',
    'abortFileUpload',
  ])
  upload
    .argument('<path>', 'Local file to upload')
    .allowExcessArguments(false)
    .description('Upload a file to the workspace')
    .option('--folder <path>', 'Folder path as shown in the app; defaults to the root folder')
    .option('--name <name>', 'Store it under a different name')
    .action(async (path: string, options: { folder?: string; name?: string }) => {
      const { client, profile } = connectUpload()
      const workspaceId = client.requireWorkspace()
      const { name, size } = await localFile(path, options.name)

      const created = await client.request<CreateFileUploadResponse>('createFileUpload', {
        body: {
          workspaceId,
          name,
          contentType: contentTypeFor(name),
          size,
          // `<path>` above is a LOCAL file and must stay untouched; only the
          // destination folder is a wire-encoded API path.
          ...(options.folder !== undefined ? { folderPath: encodeFolderPath(options.folder) } : {}),
        },
      })
      const { session, uploadToken, transfer } = created.data
      const completed: CompleteFileUploadResponse['data'] = await finishUploadSession(
        client,
        workspaceId,
        {
          operations: {
            parts: 'createFileUploadPartUrls',
            complete: 'completeFileUpload',
            abort: 'abortFileUpload',
          },
          params: { uploadId: session.id },
          uploadToken,
          transfer,
          size,
        },
        path
      )

      if (!completed.file) {
        throw new Error(`File upload ${session.id} completed without a file`)
      }
      /**
       * The file record, and nothing about the session that carried it.
       *
       * The session is over by the time this line runs — completed on success,
       * aborted on failure — so its id names nothing a caller can go on to ask
       * about, and its token is a live credential that also authorizes
       * aborting and completing the transfer. This command runs in CI, where
       * stdout is retained and broadly readable; neither belongs in it.
       */
      printProtocolResult(profile.output, completed.file)
    })
}
