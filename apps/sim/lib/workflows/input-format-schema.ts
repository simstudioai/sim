import { z } from 'zod'

/** The input field types the editor offers. */
const INPUT_FORMAT_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'file[]',
] as const

export type InputFormatFieldType = (typeof INPUT_FORMAT_FIELD_TYPES)[number]

/** Every canonical type by name, plus `files`, the legacy MCP alias of `file[]`. */
const INPUT_FORMAT_FIELD_TYPES_BY_NAME = new Map<string, InputFormatFieldType>([
  ...INPUT_FORMAT_FIELD_TYPES.map((type) => [type, type] as const),
  ['files', 'file[]'],
])

/**
 * Resolves a stored field's `type` to its canonical type, or `null` when it
 * names none. A field without a type is a string field.
 */
export function canonicalInputFormatFieldType(
  type: string | undefined
): InputFormatFieldType | null {
  if (type === undefined) return 'string'
  return INPUT_FORMAT_FIELD_TYPES_BY_NAME.get(type) ?? null
}

/** Stored fields shared by the input editor and catalog authoring contract. */
export const inputFormatFieldStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(INPUT_FORMAT_FIELD_TYPES),
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
