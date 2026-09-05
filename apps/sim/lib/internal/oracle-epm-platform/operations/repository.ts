import {
  downloadRepositoryFile,
  listRepositoryFiles,
  uploadRepositoryFile,
  uploadSnapshot,
} from '@/lib/internal/oracle-epm-platform/files.server'
import { projectJob } from '@/lib/internal/oracle-epm-platform/jobs'
import type { OracleEpmPlatformOperationImplementations } from '@/lib/internal/oracle-epm-platform/operations'
import {
  jsonBody,
  migrationsSchema,
  parseResponse,
  requireSuccess,
  snapshotsSchema,
  statusOutput,
} from '@/lib/internal/oracle-epm-platform/responses'
import { endpoints } from '@/lib/internal/oracle-epm-platform/routes'

export const repositoryToolHandlers = {
  list_files: async (_input, { client, signal }) => ({
    ...statusOutput(0),
    files: await listRepositoryFiles(client, signal),
  }),
  delete_file: async (input, { client, signal }) =>
    requireSuccess(
      jsonBody(
        await client.request(endpoints.delete_file, {
          json: { fileName: input.fileName },
          signal,
        })
      )
    ),
  get_snapshot: async (input, { client, signal }) => {
    const value = jsonBody(
      await client.request(endpoints.get_snapshot, {
        pathParams: { snapshotName: input.snapshotName },
        signal,
      })
    )
    return { ...requireSuccess(value), snapshots: parseResponse(snapshotsSchema, value).items }
  },
  export_snapshot: async (input, { client, signal }) =>
    projectJob(
      client,
      jsonBody(
        await client.request(endpoints.export_snapshot, {
          json: { snapshotName: input.snapshotName },
          signal,
        })
      ),
      'migration'
    ),
  import_snapshot: async (input, { client, signal }) =>
    projectJob(
      client,
      jsonBody(
        await client.request(endpoints.import_snapshot, {
          json: {
            snapshotName: input.snapshotName,
            parameters: {
              importUsers: input.importUsers ? 'TRUE' : 'FALSE',
              ...(input.importUsers
                ? {
                    resetPassword: input.resetPassword === false ? 'FALSE' : 'TRUE',
                    ...(input.userPassword === undefined
                      ? {}
                      : { userPassword: input.userPassword }),
                  }
                : {}),
            },
          },
          signal,
        })
      ),
      'migration'
    ),
  // Rename documents a synchronous result. A surprising -1 is an error, not an invented job kind.
  rename_snapshot: async (input, { client, signal }) =>
    requireSuccess(
      jsonBody(
        await client.request(endpoints.rename_snapshot, {
          json: { snapshotName: input.snapshotName, newSnapshotName: input.newSnapshotName },
          signal,
        })
      )
    ),
  list_migrations: async (_input, { client, signal }) => {
    const value = jsonBody(await client.request(endpoints.list_migrations, { signal }))
    return { ...requireSuccess(value), migrations: parseResponse(migrationsSchema, value).items }
  },
  upload_repository_file: uploadRepositoryFile,
  upload_snapshot: uploadSnapshot,
  download_file: downloadRepositoryFile,
} satisfies Pick<
  OracleEpmPlatformOperationImplementations,
  | 'list_files'
  | 'delete_file'
  | 'get_snapshot'
  | 'export_snapshot'
  | 'import_snapshot'
  | 'rename_snapshot'
  | 'list_migrations'
  | 'upload_repository_file'
  | 'upload_snapshot'
  | 'download_file'
>
