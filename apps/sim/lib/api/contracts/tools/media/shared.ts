import { z } from 'zod'

export const AWS_REGION_PATTERN =
  /^(eu-isoe|us-isob|us-iso|us-gov|af|ap|ca|cn|eu|il|me|mx|sa|us)-(central|north|northeast|northwest|south|southeast|southwest|east|west)-\d{1,2}$/

export const toolJsonResponseSchema = z
  .object({
    success: z.boolean().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    data: z.unknown().optional(),
  })
  .passthrough()
