import { z } from 'zod'

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

export const RawFileInputArraySchema = z.array(RawFileInputSchema)

export const FileInputSchema = z.union([RawFileInputSchema, z.string()])
