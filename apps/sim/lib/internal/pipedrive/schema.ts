import { z } from 'zod'

export const pipedriveGetFilesInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  authStyle: z.enum(['x-api-token']).optional(),
  sort: z.enum(['id', 'update_time']).optional().nullable(),
  limit: z.string().optional().nullable(),
  start: z.string().optional().nullable(),
  downloadFiles: z.boolean().optional().default(false),
})

export type PipedriveGetFilesInput = z.output<typeof pipedriveGetFilesInputSchema>
