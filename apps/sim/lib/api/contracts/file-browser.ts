import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { FILE_BROWSER_SIZES, FILE_BROWSER_TYPES } from '@/lib/workspace-files/browser'

export const fileBrowserCreatorSchema = z.object({
  id: nonEmptyIdSchema,
  name: z.string(),
  image: z.string().nullable(),
  deleted: z.boolean(),
})
export const fileBrowserItemSchema = z.object({
  id: nonEmptyIdSchema,
  kind: z.enum(['file', 'folder']),
  name: z.string(),
  parentId: nonEmptyIdSchema.nullable(),
  size: z.number().nonnegative(),
  type: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  creator: fileBrowserCreatorSchema.nullable(),
})
export const fileBrowserTypesQuerySchema = z
  .union([z.enum(FILE_BROWSER_TYPES), z.array(z.enum(FILE_BROWSER_TYPES)).max(4)])
  .transform((value) => (typeof value === 'string' ? [value] : value))
  .default([])
export const fileBrowserSizesQuerySchema = z
  .union([z.enum(FILE_BROWSER_SIZES), z.array(z.enum(FILE_BROWSER_SIZES)).max(3)])
  .transform((value) => (typeof value === 'string' ? [value] : value))
  .default([])
export const fileBrowserCreatorsQuerySchema = z
  .union([nonEmptyIdSchema, z.array(nonEmptyIdSchema).max(100)])
  .transform((value) => (typeof value === 'string' ? [value] : value))
  .default([])
