import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const tiktokUploadVideoDraftInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  file: RawFileInputSchema,
})

export type TikTokUploadVideoDraftInput = z.output<typeof tiktokUploadVideoDraftInputSchema>
