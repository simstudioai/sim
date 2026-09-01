import { z } from 'zod'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

const connectionFields = {
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
}

function requireCredentials<S extends z.ZodType>(schema: S): S {
  return schema.refine(
    (value) => {
      const connection = value as { password?: string | null; privateKey?: string | null }
      return Boolean(connection.password || connection.privateKey)
    },
    { message: 'Either password or privateKey must be provided' }
  ) as S
}

export const sftpListInputSchema = requireCredentials(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    detailed: z.boolean().default(false),
  })
)

export const sftpDeleteInputSchema = requireCredentials(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    recursive: z.boolean().default(false),
  })
)

export const sftpMkdirInputSchema = requireCredentials(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    recursive: z.boolean().default(false),
  })
)

export const sftpDownloadInputSchema = requireCredentials(
  z.object({
    ...connectionFields,
    remotePath: z.string().min(1, 'Remote path is required'),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  })
)

export const sftpUploadInputSchema = requireCredentials(
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

export type SftpListInput = z.output<typeof sftpListInputSchema>
export type SftpDeleteInput = z.output<typeof sftpDeleteInputSchema>
export type SftpMkdirInput = z.output<typeof sftpMkdirInputSchema>
export type SftpDownloadInput = z.output<typeof sftpDownloadInputSchema>
export type SftpUploadInput = z.output<typeof sftpUploadInputSchema>
