import { z } from 'zod'
import {
  batchPresignedUploadResponseSchema,
  presignedUploadResponseSchema,
} from '@/lib/api/contracts/file-uploads'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  type ContractParamsInput,
  type ContractQueryInput,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import {
  FileInputSchema,
  RawFileInputArraySchema,
  RawFileInputSchema,
} from '@/lib/uploads/utils/file-schemas'

const jsonResponseSchema = z.unknown()

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  const value = bytes / k ** i
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${sizes[i]}`
}

const multipartPartUrlSchema = z.object({
  partNumber: z.number(),
  url: z.string(),
  blockId: z.string().optional(),
})

const multipartCompletedUploadSchema = z.object({
  success: z.literal(true),
  location: z.string(),
  path: z.string(),
  key: z.string(),
})

const initiateMultipartResponseSchema = z.object({
  uploadId: z.string(),
  key: z.string(),
  uploadToken: z.string(),
})

const getMultipartPartUrlsResponseSchema = z.object({
  presignedUrls: z.array(multipartPartUrlSchema),
})

const completeMultipartResponseSchema = z.union([
  multipartCompletedUploadSchema,
  z.object({
    results: z.array(multipartCompletedUploadSchema),
  }),
])

const abortMultipartResponseSchema = z.object({
  success: z.literal(true),
})

const multipartUploadResponseSchema = z.union([
  initiateMultipartResponseSchema,
  getMultipartPartUrlsResponseSchema,
  completeMultipartResponseSchema,
  abortMultipartResponseSchema,
])

const connectionFields = {
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
}

function requirePasswordOrPrivateKey<S extends z.ZodType>(schema: S): S {
  return schema.refine(
    (value) => {
      const connection = value as { password?: string | null; privateKey?: string | null }
      return Boolean(connection.password || connection.privateKey)
    },
    { message: 'Either password or privateKey must be provided' }
  ) as S
}

const boxUploadBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  parentFolderId: z.string().min(1, 'Parent folder ID is required'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
})

const dropboxUploadBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  path: z.string().min(1, 'Destination path is required'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  mode: z.enum(['add', 'overwrite']).optional().nullable(),
  autorename: z.boolean().optional().nullable(),
  mute: z.boolean().optional().nullable(),
})

const wordpressUploadBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  siteId: z.string().min(1, 'Site ID is required'),
  file: RawFileInputSchema.optional().nullable(),
  filename: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  altText: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
})

const sftpListBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    detailed: z.boolean().default(false),
  })
)

const sftpDeleteBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    recursive: z.boolean().default(false),
  })
)

const sftpMkdirBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    recursive: z.boolean().default(false),
  })
)

const sftpDownloadBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  })
)

const sftpUploadBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    files: RawFileInputArraySchema.optional().nullable(),
    fileContent: z.string().nullish(),
    fileName: z.string().nullish(),
    overwrite: z.boolean().default(true),
    permissions: z.string().nullish(),
  })
)

const sshCheckCommandExistsBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    commandName: z.string().min(1, 'Command name is required'),
  })
)

const sshCheckFileExistsBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    path: z.string().min(1, 'Path is required'),
    type: z.enum(['file', 'directory', 'any']).default('any'),
  })
)

const sshCreateDirectoryBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    path: z.string().min(1, 'Path is required'),
    recursive: z.boolean().default(true),
    permissions: z.string().default('0755'),
  })
)

const sshDeleteFileBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    path: z.string().min(1, 'Path is required'),
    recursive: z.boolean().default(false),
    force: z.boolean().default(false),
  })
)

const sshDownloadFileBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
  })
)

const sshExecuteCommandBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    command: z.string().min(1, 'Command is required'),
    workingDirectory: z.string().nullish(),
  })
)

const sshExecuteScriptBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    script: z.string().min(1, 'Script content is required'),
    interpreter: z.string().default('/bin/bash'),
    workingDirectory: z.string().nullish(),
  })
)

const sshGetSystemInfoBodySchema = requirePasswordOrPrivateKey(z.object(connectionFields))

const sshListDirectoryBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    path: z.string().min(1, 'Path is required'),
    detailed: z.boolean().default(true),
    recursive: z.boolean().default(false),
  })
)

const sshMoveRenameBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    sourcePath: z.string().min(1, 'Source path is required'),
    destinationPath: z.string().min(1, 'Destination path is required'),
    overwrite: z.boolean().default(false),
  })
)

const sshReadFileContentBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    path: z.string().min(1, 'Path is required'),
    encoding: z.string().default('utf-8'),
    maxSize: z.coerce.number().default(10),
  })
)

const sshUploadFileBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    fileContent: z.string().min(1, 'File content is required'),
    fileName: z.string().min(1, 'File name is required'),
    remotePath: z.string().min(1, 'Remote path is required'),
    permissions: z.string().nullish(),
    overwrite: z.boolean().default(true),
  })
)

const sshWriteFileContentBodySchema = requirePasswordOrPrivateKey(
  z.object({
    ...connectionFields,
    path: z.string().min(1, 'Path is required'),
    content: z.string(),
    mode: z.enum(['overwrite', 'append', 'create']).default('overwrite'),
    permissions: z.string().nullish(),
  })
)

const storageContextSchema = z.enum([
  'knowledge-base',
  'chat',
  'copilot',
  'mothership',
  'execution',
  'workspace',
  'profile-pictures',
  'og-images',
  'logs',
  'workspace-logos',
])

const downloadContextSchema = z.union([storageContextSchema, z.literal('general')])

const fileDownloadBodySchema = z
  .object({
    key: z.string().optional(),
    name: z.string().optional(),
    isExecutionFile: z.boolean().optional(),
    context: downloadContextSchema.optional(),
    url: z
      .url()
      .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
        message: 'URL must use http or https',
      })
      .optional(),
  })
  .passthrough()

const fileParseBodySchema = z
  .object({
    filePath: z.union([z.string(), z.array(z.string())]).optional(),
    fileType: z.string().optional().default(''),
    workspaceId: z.string().optional().default(''),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
  })
  .passthrough()

const fileDeleteBodySchema = z
  .object({
    filePath: z.string().optional(),
    context: storageContextSchema.optional(),
  })
  .passthrough()

const MAX_FILE_SIZE = 100 * 1024 * 1024
const validUploadTypes = [
  'knowledge-base',
  'chat',
  'copilot',
  'profile-pictures',
  'mothership',
  'workspace-logos',
  'execution',
] as const

export const uploadTypeSchema = z.enum(validUploadTypes)

const presignedUploadQuerySchema = z.object({
  type: uploadTypeSchema,
})

const presignedUrlBodySchema = z
  .object({
    fileName: z
      .string({ error: 'fileName is required and cannot be empty' })
      .refine((value) => value.trim().length > 0, {
        message: 'fileName is required and cannot be empty',
      }),
    contentType: z
      .string({ error: 'contentType is required and cannot be empty' })
      .refine((value) => value.trim().length > 0, {
        message: 'contentType is required and cannot be empty',
      }),
    fileSize: z
      .number({ error: 'fileSize must be a positive number' })
      .positive('fileSize must be a positive number')
      .superRefine((val, ctx) => {
        if (val > MAX_FILE_SIZE) {
          ctx.addIssue({
            code: 'custom',
            message: `File size ${formatFileSize(val)} exceeds maximum allowed size of ${formatFileSize(MAX_FILE_SIZE)}`,
          })
        }
      }),
    userId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

const batchPresignedUrlBodySchema = z
  .object({
    files: z
      .array(
        z
          .object({
            fileName: z.string().refine((value) => value.trim().length > 0, {
              message: 'fileName is required for all files',
            }),
            contentType: z.string().refine((value) => value.trim().length > 0, {
              message: 'contentType is required for all files',
            }),
            fileSize: z.number(),
          })
          .passthrough()
          .superRefine((file, ctx) => {
            const name = typeof file.fileName === 'string' ? file.fileName : 'file'
            if (!Number.isFinite(file.fileSize) || file.fileSize <= 0) {
              ctx.addIssue({
                code: 'custom',
                path: ['fileSize'],
                message: `${name} is empty (fileSize must be greater than 0)`,
              })
            } else if (file.fileSize > MAX_FILE_SIZE) {
              ctx.addIssue({
                code: 'custom',
                path: ['fileSize'],
                message: `${name} (${formatFileSize(file.fileSize)}) exceeds maximum allowed size of ${formatFileSize(MAX_FILE_SIZE)}`,
              })
            }
          })
      )
      .min(1, 'files array is required and cannot be empty')
      .max(100, 'Cannot process more than 100 files at once'),
  })
  .passthrough()

export const multipartActionSchema = z.enum(['initiate', 'get-part-urls', 'complete', 'abort'])

const initiateMultipartBodySchema = z
  .object({
    fileName: z.string(),
    contentType: z.string(),
    fileSize: z.number(),
    workspaceId: z.string({ error: 'workspaceId is required' }).min(1, 'workspaceId is required'),
    context: z.string().optional(),
  })
  .passthrough()

const tokenBoundMultipartBodySchema = z
  .object({
    uploadToken: z.string().optional(),
  })
  .passthrough()

const getMultipartPartUrlsBodySchema = tokenBoundMultipartBodySchema.extend({
  partNumbers: z.array(z.number()),
})

const completeMultipartBodySchema = z
  .object({
    uploadToken: z.string().optional(),
    parts: z.unknown().optional(),
    uploads: z
      .array(
        z
          .object({
            uploadToken: z.string().optional(),
            parts: z.unknown().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough()

export type CompleteMultipartBody = z.output<typeof completeMultipartBodySchema>

export const uploadFilesFormFilesSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.filter((entry) => entry instanceof File) : value),
  z.array(z.custom<File>((value) => value instanceof File)).min(1, 'No files provided')
)

export const uploadFilesFormFieldsSchema = z.object({
  workflowId: z.string().nullable(),
  executionId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  context: z.string().nullable(),
})

export const fileServeParamsSchema = z.object({
  path: z.array(z.string()).min(1),
})

export const fileServeQuerySchema = z.object({
  raw: z.string().nullish(),
})

const fileViewParamsSchema = z.object({
  id: z.string().uuid('File ID must be a valid UUID'),
})

const fileExportParamsSchema = z.object({
  id: z.string().uuid('File ID must be a valid UUID'),
})

export const boxUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/box/upload',
  body: boxUploadBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const dropboxUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/dropbox/upload',
  body: dropboxUploadBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const wordpressUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/wordpress/upload',
  body: wordpressUploadBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

const sftpListContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sftp/list',
  body: sftpListBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sftpDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sftp/delete',
  body: sftpDeleteBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sftpMkdirContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sftp/mkdir',
  body: sftpMkdirBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sftpDownloadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sftp/download',
  body: sftpDownloadBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sftpUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sftp/upload',
  body: sftpUploadBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshCheckCommandExistsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/check-command-exists',
  body: sshCheckCommandExistsBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshCheckFileExistsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/check-file-exists',
  body: sshCheckFileExistsBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshCreateDirectoryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/create-directory',
  body: sshCreateDirectoryBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshDeleteFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/delete-file',
  body: sshDeleteFileBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshDownloadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/download-file',
  body: sshDownloadFileBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshExecuteCommandContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/execute-command',
  body: sshExecuteCommandBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshExecuteScriptContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/execute-script',
  body: sshExecuteScriptBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshGetSystemInfoContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/get-system-info',
  body: sshGetSystemInfoBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshListDirectoryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/list-directory',
  body: sshListDirectoryBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshMoveRenameContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/move-rename',
  body: sshMoveRenameBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshReadFileContentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/read-file-content',
  body: sshReadFileContentBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshUploadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/upload-file',
  body: sshUploadFileBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const sshWriteFileContentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssh/write-file-content',
  body: sshWriteFileContentBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const fileDownloadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/download',
  body: fileDownloadBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const fileParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/parse',
  body: fileParseBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

export const fileDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/delete',
  body: fileDeleteBodySchema,
  response: { mode: 'json', schema: jsonResponseSchema },
})

const fileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/upload',
  response: { mode: 'json', schema: jsonResponseSchema },
})

const presignedUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned',
  query: presignedUploadQuerySchema,
  body: presignedUrlBodySchema,
  response: { mode: 'json', schema: presignedUploadResponseSchema },
})

export const presignedUploadBodyContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned',
  body: presignedUrlBodySchema,
  response: { mode: 'json', schema: presignedUploadResponseSchema },
})

const batchPresignedUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned/batch',
  query: presignedUploadQuerySchema,
  body: batchPresignedUrlBodySchema,
  response: { mode: 'json', schema: batchPresignedUploadResponseSchema },
})

export const batchPresignedUploadBodyContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned/batch',
  body: batchPresignedUrlBodySchema,
  response: { mode: 'json', schema: batchPresignedUploadResponseSchema },
})

const multipartUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/multipart',
  response: { mode: 'json', schema: multipartUploadResponseSchema },
})

export const initiateMultipartUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/multipart',
  body: initiateMultipartBodySchema,
  response: { mode: 'json', schema: initiateMultipartResponseSchema },
})

export const getMultipartPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/multipart',
  body: getMultipartPartUrlsBodySchema,
  response: { mode: 'json', schema: getMultipartPartUrlsResponseSchema },
})

export const completeMultipartUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/multipart',
  body: completeMultipartBodySchema,
  response: { mode: 'json', schema: completeMultipartResponseSchema },
})

export const abortMultipartUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/multipart',
  body: tokenBoundMultipartBodySchema,
  response: { mode: 'json', schema: abortMultipartResponseSchema },
})

const fileServeContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/serve/[...path]',
  params: fileServeParamsSchema,
  query: fileServeQuerySchema,
  response: { mode: 'binary' },
})

export const fileViewContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/view/[id]',
  params: fileViewParamsSchema,
  response: { mode: 'binary' },
})

export const fileExportContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/export/[id]',
  params: fileExportParamsSchema,
  response: { mode: 'binary' },
})

type BoxUploadBody = ContractBodyInput<typeof boxUploadContract>
type BoxUploadResponse = ContractJsonResponse<typeof boxUploadContract>
type DropboxUploadBody = ContractBodyInput<typeof dropboxUploadContract>
type DropboxUploadResponse = ContractJsonResponse<typeof dropboxUploadContract>
type WordPressUploadBody = ContractBodyInput<typeof wordpressUploadContract>
type WordPressUploadResponse = ContractJsonResponse<typeof wordpressUploadContract>
type SftpDownloadBody = ContractBodyInput<typeof sftpDownloadContract>
type SftpUploadBody = ContractBodyInput<typeof sftpUploadContract>
type SftpDeleteBody = ContractBodyInput<typeof sftpDeleteContract>
type SftpMkdirBody = ContractBodyInput<typeof sftpMkdirContract>
type SshCheckCommandExistsBody = ContractBodyInput<typeof sshCheckCommandExistsContract>
type SshCheckFileExistsBody = ContractBodyInput<typeof sshCheckFileExistsContract>
type SshCreateDirectoryBody = ContractBodyInput<typeof sshCreateDirectoryContract>
type SshDeleteFileBody = ContractBodyInput<typeof sshDeleteFileContract>
type SshDownloadFileBody = ContractBodyInput<typeof sshDownloadFileContract>
type SshExecuteCommandBody = ContractBodyInput<typeof sshExecuteCommandContract>
type SshExecuteScriptBody = ContractBodyInput<typeof sshExecuteScriptContract>
type SshGetSystemInfoBody = ContractBodyInput<typeof sshGetSystemInfoContract>
type SshListDirectoryBody = ContractBodyInput<typeof sshListDirectoryContract>
type SshMoveRenameBody = ContractBodyInput<typeof sshMoveRenameContract>
type SshReadFileContentBody = ContractBodyInput<typeof sshReadFileContentContract>
type SshUploadFileBody = ContractBodyInput<typeof sshUploadFileContract>
type SshWriteFileContentBody = ContractBodyInput<typeof sshWriteFileContentContract>
type FileDownloadBody = ContractBodyInput<typeof fileDownloadContract>
type FileDownloadResponse = ContractJsonResponse<typeof fileDownloadContract>
type FileParseBody = ContractBodyInput<typeof fileParseContract>
type FileParseResponse = ContractJsonResponse<typeof fileParseContract>
type FileDeleteBody = ContractBodyInput<typeof fileDeleteContract>
type FileDeleteResponse = ContractJsonResponse<typeof fileDeleteContract>
type PresignedUploadQuery = ContractQueryInput<typeof presignedUploadContract>
type PresignedUploadBody = ContractBodyInput<typeof presignedUploadContract>
type PresignedUploadResponse = ContractJsonResponse<typeof presignedUploadContract>
type BatchPresignedUploadQuery = ContractQueryInput<typeof batchPresignedUploadContract>
type BatchPresignedUploadBody = ContractBodyInput<typeof batchPresignedUploadContract>
type BatchPresignedUploadResponse = ContractJsonResponse<typeof batchPresignedUploadContract>
type MultipartAction = z.output<typeof multipartActionSchema>
type InitiateMultipartBody = z.output<typeof initiateMultipartBodySchema>
type TokenBoundMultipartBody = z.output<typeof tokenBoundMultipartBodySchema>
type GetMultipartPartUrlsBody = z.output<typeof getMultipartPartUrlsBodySchema>
type FileServeParams = ContractParamsInput<typeof fileServeContract>
type FileServeQuery = ContractQueryInput<typeof fileServeContract>
type FileViewParams = ContractParamsInput<typeof fileViewContract>
type FileExportParams = ContractParamsInput<typeof fileExportContract>
