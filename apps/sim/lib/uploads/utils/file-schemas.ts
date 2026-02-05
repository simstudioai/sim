import { z } from 'zod'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'

const isUrlLike = (value: string) =>
  value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')

export const RawFileInputSchema = z
  .object({
    id: z.string().optional(),
    key: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
    name: z.string().min(1),
    size: z.number().nonnegative(),
    type: z.string().optional(),
    uploadedAt: z.union([z.string(), z.date()]).optional(),
    expiresAt: z.union([z.string(), z.date()]).optional(),
    context: z.string().optional(),
    base64: z.string().optional(),
  })
  .passthrough()
  .refine((data) => Boolean(data.key || data.path || data.url), {
    message: 'File must include key, path, or url',
  })
  .refine(
    (data) => {
      if (data.key || data.path) {
        return true
      }
      if (!data.url) {
        return true
      }
      return isInternalFileUrl(data.url)
    },
    { message: 'File url must reference an uploaded file' }
  )
  .refine(
    (data) => {
      if (data.key || !data.path) {
        return true
      }
      if (!isUrlLike(data.path)) {
        return true
      }
      return isInternalFileUrl(data.path)
    },
    { message: 'File path must reference an uploaded file' }
  )

export const RawFileInputArraySchema = z.array(RawFileInputSchema)

export const FileInputSchema = z.union([RawFileInputSchema, z.string()])
