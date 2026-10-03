import { z } from 'zod'

const scopeSchema = z.enum(['account', 'organization', 'workspace'])
const sectionSchema = z.string().trim().min(1).max(64)
const targetShape = {
  scope: scopeSchema,
  workspaceId: z
    .uuid()
    .optional()
    .describe(
      'Explicit workspace target in organization chat; omit for account and organization settings.'
    ),
}

/** Section updates are validated against their canonical domain schema after discovery. */
export const mothershipSettingsInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...targetShape, action: z.literal('list') }),
  z.strictObject({ ...targetShape, action: z.literal('get'), section: sectionSchema }),
  z.strictObject({ ...targetShape, action: z.literal('open'), section: sectionSchema }),
  z.strictObject({
    ...targetShape,
    action: z.literal('describe'),
    section: sectionSchema,
    operation: z.string().trim().min(1).max(64),
  }),
  z.strictObject({
    ...targetShape,
    action: z.literal('execute'),
    section: sectionSchema,
    operation: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe('Exact operation from get for this section.'),
    input: z
      .record(z.string(), z.unknown())
      .describe('Inputs matching the operation schema from get.'),
  }),
  z.strictObject({
    ...targetShape,
    action: z.literal('update'),
    section: sectionSchema,
    changes: z
      .record(z.string(), z.unknown())
      .describe(
        'Only fields from the updateSchema returned by get. Unrecognized fields are rejected; secrets use the setup UI.'
      ),
  }),
])
export type MothershipSettingsInput = z.output<typeof mothershipSettingsInputSchema>
export type MothershipSettingsScope = z.output<typeof scopeSchema>
