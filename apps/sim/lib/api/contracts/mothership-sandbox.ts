import { z } from 'zod'

/** Private transport address only; the selected v2 contract owns query, body and response. */
export const mothershipSandboxParamsSchema = z.object({
  token: z.uuid(),
  path: z.array(z.string().min(1)).min(1),
})

export type MothershipSandboxParams = z.infer<typeof mothershipSandboxParamsSchema>
