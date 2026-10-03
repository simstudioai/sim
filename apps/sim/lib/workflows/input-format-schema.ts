import { z } from 'zod'

/** Stored fields shared by the input editor and catalog authoring contract. */
export const inputFormatFieldStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'file[]']),
  value: z.string(),
  description: z.string().optional(),
  collapsed: z.boolean(),
})

export type InputFormatFieldState = z.infer<typeof inputFormatFieldStateSchema>

/** Editing operations assign row IDs; defaults are text, including serialized arrays/objects. */
export const inputFormatValueSchema = z.array(
  inputFormatFieldStateSchema.partial({ id: true, value: true, collapsed: true }).extend({
    value: z
      .string()
      .optional()
      .describe('Default value as text; serialize arrays/objects as JSON.'),
  })
)
