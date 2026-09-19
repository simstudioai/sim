import { z } from 'zod'
import {
  noInputSchema,
  versionNumberPathSchema,
  versionNumberSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2FileParamsSchema,
  v2FileSchema,
  v2FileTextSchema,
  v2FileWorkspaceQuerySchema,
  v2ReadFileTextQuerySchema,
} from '@/lib/api/contracts/v2/files'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 file version history contracts. Every content write that changes the bytes — an upload, an
 * API or editor save, a Sim edit, a workflow write, a revert — records a version; collaborative
 * edits and repeated workflow writes from one author fold into one version per ten-minute window. Renames and moves
 * are metadata changes and never create versions, so every version reads under the file's
 * current name.
 */

export const v2FileVersionSourceSchema = z
  .enum(['upload', 'user', 'api', 'copilot', 'workflow', 'collab', 'revert', 'unknown'])
  .describe(
    'What wrote this version: `upload` (the original upload), `user` (a save in the Sim editor), `api` (an API, CLI, or MCP write), `copilot` (Sim, the agent), `workflow` (a workflow run), `collab` (collaborative editing), `revert` (a revert to an earlier version), or `unknown` (content written before version history existed).'
  )

export const v2FileVersionAuthorSchema = z
  .object({
    id: z.string().describe('User identifier.'),
    email: z
      .email({ pattern: z.regexes.html5Email })
      .nullable()
      .describe('Current email address of the user, or null when the account no longer exists.'),
  })
  .strict()

/** One version of a workspace file as exposed by the v2 surface. */
export const v2FileVersionSchema = z
  .object({
    fileId: z.string().describe('File this version belongs to.'),
    version: versionNumberSchema
      .describe(
        'Version number, increasing by one per recorded version. Numbers are never reused, so a gap means retention removed that version.'
      )
      .meta({ examples: [3] }),
    isCurrent: z.boolean().describe('Whether this version holds the current content of the file.'),
    size: z
      .number()
      .int()
      .nonnegative()
      .describe('Size in bytes of the stored content of this version.'),
    contentType: z.string().describe('MIME type of the stored content of this version.'),
    source: v2FileVersionSourceSchema,
    authors: z
      .array(v2FileVersionAuthorSchema)
      .describe(
        'Users who wrote this version, in order of first contribution. Empty for actorless writers such as workspace API keys. A collaborative version lists every editor in its window.'
      ),
    restoredFromVersion: versionNumberSchema
      .nullable()
      .describe('For a `revert` version, the version whose content it restored; otherwise null.'),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when this content became current.')
      .meta({ format: 'date-time', examples: ['2026-01-15T10:30:00Z'] }),
    updatedAt: z
      .string()
      .describe(
        'ISO 8601 timestamp of the last write folded into this version. Equals `createdAt` unless edits were coalesced into it.'
      )
      .meta({ format: 'date-time', examples: ['2026-01-15T10:38:00Z'] }),
    supersededAt: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 timestamp when a newer version replaced this one, or null for the current version. Retention ages versions from this time.'
      )
      .meta({ format: 'date-time', examples: ['2026-01-16T09:00:00Z'] }),
  })
  .strict()
  .meta({
    id: 'V2FileVersion',
    title: 'File version',
    description: 'One recorded version of the content of a workspace file.',
  })

export type V2FileVersion = z.output<typeof v2FileVersionSchema>

export const v2FileVersionParamsSchema = v2FileParamsSchema.extend({
  version: versionNumberPathSchema.describe('Version number.'),
})

export const v2FileVersionSortFields = ['version'] as const

export const v2ListFileVersionsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    ...v2SortFields(v2FileVersionSortFields, { sortBy: 'version', sortOrder: 'desc' }),
    ...v2PaginationFields({ description: 'Maximum versions to return per page.' }),
  })
  .strict()

export type V2ListFileVersionsQuery = z.output<typeof v2ListFileVersionsQuerySchema>

export const v2FileVersionTextSchema = v2FileTextSchema
  .extend({
    version: versionNumberSchema.describe('Version the text was extracted from.'),
  })
  .meta({
    id: 'V2FileVersionText',
    title: 'Extracted file version text',
    description:
      'Text extracted from one version of a workspace file, with extraction-quality flags.',
  })

export const v2RevertFileVersionBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    expectedCurrentVersion: versionNumberSchema
      .optional()
      .describe(
        'Revert only while this is still the current version; otherwise the request fails with `409`. Omit to revert whatever is current. Collaborative edits and repeated workflow writes that fold into the current version keep its number.'
      ),
  })
  .strict()

export type V2RevertFileVersionBody = z.input<typeof v2RevertFileVersionBodySchema>

export const v2RevertFileVersionResultSchema = z
  .object({
    reverted: z
      .boolean()
      .describe(
        'False when the requested version was already current, in which case nothing was written.'
      ),
    file: v2FileSchema,
    version: v2FileVersionSchema.describe(
      'The current version of the file after the revert: a new `revert` version; the requested version when it was already current; or the unchanged current version when its content already matched the requested one.'
    ),
  })
  .strict()
  .meta({
    id: 'V2FileVersionRevertResult',
    title: 'Revert file version result',
    description: 'The file and its current version after a revert.',
  })

export type V2FileVersionRevertResult = z.output<typeof v2RevertFileVersionResultSchema>

export const v2ListFileVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/versions',
  params: v2FileParamsSchema,
  query: v2ListFileVersionsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2FileVersionSchema),
  },
})

export const v2GetFileVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/versions/[version]',
  params: v2FileVersionParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileVersionSchema),
  },
})

/** Text of one version, extracted exactly as `GET /api/v2/files/[fileId]/text` extracts it. */
export const v2ReadFileVersionTextContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/versions/[version]/text',
  params: v2FileVersionParamsSchema,
  query: v2ReadFileTextQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileVersionTextSchema),
  },
})

/** Bytes of one version, served exactly as `GET /api/v2/files/[fileId]` serves the current ones. */
export const v2DownloadFileVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/versions/[version]/content',
  params: v2FileVersionParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const v2DeleteFileVersionResultSchema = z
  .object({
    fileId: z.string().describe('File whose version was deleted.'),
    version: versionNumberSchema.describe('Version number that was deleted.'),
    deleted: z.literal(true).describe('Always true: the version and its stored content are gone.'),
  })
  .strict()
  .meta({
    id: 'V2FileVersionDeleteResult',
    title: 'Delete file version result',
    description: 'Deletion acknowledgement for one file version.',
  })

export type V2FileVersionDeleteResult = z.output<typeof v2DeleteFileVersionResultSchema>

/**
 * Permanently deletes one superseded version, for purging content from history before retention
 * would. The current version is the file itself and cannot be deleted.
 */
export const v2DeleteFileVersionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/files/[fileId]/versions/[version]',
  params: v2FileVersionParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteFileVersionResultSchema),
  },
})

/**
 * Makes a version's content current again by writing it as a new version, so a revert is itself
 * revertible. Named `revert` because `restore` already means un-archiving a deleted file.
 */
export const v2RevertFileVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/[fileId]/versions/[version]/revert',
  params: v2FileVersionParamsSchema,
  query: noInputSchema,
  body: v2RevertFileVersionBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RevertFileVersionResultSchema),
  },
})
