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

export const toolBooleanSchema = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return value

    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0' || normalized === '') return false
    return value
  },
  z.boolean({ error: 'must be a boolean (true/false)' })
)
