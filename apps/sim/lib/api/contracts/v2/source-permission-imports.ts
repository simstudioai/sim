import { z } from 'zod'
import {
  INT4_MAX,
  noInputSchema,
  nonEmptyIdSchema,
  organizationIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  PERMISSION_IMPORT_MAX_IDENTITIES,
  PERMISSION_IMPORT_MAX_PARTS,
  PERMISSION_IMPORT_MAX_ROWS,
  PERMISSION_IMPORT_PART_MAX_ROWS,
} from '@/lib/knowledge/connectors/permission-import-limits'

const params = z.strictObject({
  organizationId: organizationIdSchema.describe('Organization identifier.'),
  sourceId: nonEmptyIdSchema.describe('Search source identifier.'),
})
const importParams = params.extend({
  importId: nonEmptyIdSchema.describe('Permission import identifier.'),
})
const path = '/api/v2/organizations/[organizationId]/search/sources/[sourceId]/permissions/imports'
const file = z.strictObject({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\p{Cc}/\\]+$/u, 'Use a filename without path separators.')
    .describe('CSV filename without path separators.'),
  parts: z
    .number()
    .int()
    .min(1)
    .max(PERMISSION_IMPORT_MAX_PARTS)
    .describe(
      'Number of nonempty parts containing this file. Both files together may contain at most 4,096 parts.'
    ),
  rowCount: z
    .number()
    .int()
    .min(1)
    .max(PERMISSION_IMPORT_MAX_ROWS)
    .describe(
      'Physical data records, excluding headers and empty lines. Must be between parts and parts × 5,000.'
    ),
})
export const permissionImportManifestSchema = z
  .strictObject({
    provider: z.literal('gitlab').describe('Provider of the configured source.'),
    expectedRevision: z
      .number()
      .int()
      .positive()
      .max(INT4_MAX - 1, 'Permission revision is out of range.')
      .describe('Permission revision pinned before exporting the CSVs.'),
    userMapping: file
      .extend({
        rowCount: z
          .number()
          .int()
          .min(1)
          .max(PERMISSION_IMPORT_MAX_IDENTITIES)
          .describe(
            'Physical user records, excluding headers and empty lines. Must be between parts and parts × 5,000.'
          ),
      })
      .describe('Complete user identity mapping.'),
    projectPermissions: file.describe('Complete project membership snapshot.'),
  })
  .superRefine((value, ctx) => {
    for (const field of ['userMapping', 'projectPermissions'] as const) {
      const { parts, rowCount } = value[field]
      if (rowCount < parts || rowCount > parts * PERMISSION_IMPORT_PART_MAX_ROWS)
        ctx.addIssue({
          code: 'custom',
          path: [field, 'rowCount'],
          message: 'Each declared part must contain between 1 and 5,000 data records.',
        })
    }
    if (value.userMapping.parts + value.projectPermissions.parts > PERMISSION_IMPORT_MAX_PARTS)
      ctx.addIssue({
        code: 'custom',
        path: ['projectPermissions', 'parts'],
        message: 'Both files together must contain at most 4,096 parts.',
      })
  })
  .describe(
    'Complete permission snapshot. The combined part count of both files must not exceed 4,096.'
  )
export type PermissionImportManifest = z.output<typeof permissionImportManifestSchema>

export const v2CreateSourcePermissionImportContract = defineRouteContract({
  method: 'POST',
  path,
  params,
  query: noInputSchema,
  body: permissionImportManifestSchema,
  response: {
    mode: 'json',
    status: 201,
    schema: v2DataResponse(
      z.strictObject({
        id: z.string().describe('Permission import identifier.'),
        expiresAt: z.iso.datetime().describe('Upload completion deadline in UTC.'),
      })
    ),
  },
})
export const v2PutSourcePermissionImportPartContract = defineRouteContract({
  method: 'PUT',
  path: `${path}/[importId]/parts/[partNumber]`,
  params: importParams.extend({
    partNumber: z.coerce
      .number()
      .int()
      .min(0)
      .max(PERMISSION_IMPORT_MAX_PARTS - 1)
      .describe('Zero-based part number across both files; user mapping comes first.'),
  }),
  query: noInputSchema,
  body: z.strictObject({
    field: z.enum(['userMapping', 'projectPermissions']).describe('CSV file this part belongs to.'),
    content: z
      .string()
      .min(1)
      .describe(
        'Complete CSV records, at most 5,000 rows and 1 MiB of UTF-8; an optional header may appear in each part.'
      ),
  }),
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.strictObject({
        nextPart: z.number().int().nonnegative().describe('Next expected part number.'),
      })
    ),
  },
})
export const v2CompleteSourcePermissionImportContract = defineRouteContract({
  method: 'POST',
  path: `${path}/[importId]/complete`,
  params: importParams,
  query: noInputSchema,
  body: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.strictObject({
        revision: z
          .number()
          .int()
          .positive()
          .describe('Permission revision committed by this import.'),
      })
    ),
  },
})
