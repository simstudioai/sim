import { z } from 'zod'
import { noInputSchema, nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  dependencyListSchema,
  sandboxBuildStatusSchema,
  sandboxCliToolSchema,
  sandboxCliToolsSchema,
  sandboxLanguageSchema,
  sandboxNameSchema,
  systemPackageListSchema,
} from '@/lib/api/contracts/sandboxes'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 sandbox contracts.
 *
 * The internal `/api/workspaces/[id]/sandboxes` surface is session-only and
 * carries `strategy` and `entitled` beside the list for the settings editor.
 * v2 is API-key-only and names the workspace on every request; a write needs a
 * Max or Enterprise plan and answers `403` otherwise, so the editor's flags
 * have no place here. The name, language, dependency, CLI, and system-package
 * validators are the internal contract's own, so both surfaces accept exactly
 * the same spec.
 */

const LANGUAGE_DESCRIPTION =
  'Dependency ecosystem: `javascript` installs from npm, `python` from PyPI.'
const DEPENDENCIES_DESCRIPTION = 'Package specifiers installed into the sandbox, one per entry.'
const CLI_TOOLS_DESCRIPTION =
  'Pinned managed CLI ids installed into the sandbox, at most 10, no duplicates.'
const SYSTEM_PACKAGES_DESCRIPTION = 'Debian packages installed into the sandbox, one per entry.'

export const v2SandboxSchema = z
  .object({
    id: z.string().describe('Unique sandbox identifier.'),
    name: z.string().describe('Display name, unique within the workspace.'),
    language: sandboxLanguageSchema.describe(LANGUAGE_DESCRIPTION),
    dependencies: z.array(z.string()).describe(DEPENDENCIES_DESCRIPTION),
    cliTools: z.array(sandboxCliToolSchema).describe(CLI_TOOLS_DESCRIPTION),
    systemPackages: z.array(z.string()).describe(SYSTEM_PACKAGES_DESCRIPTION),
    buildStatus: sandboxBuildStatusSchema
      .nullable()
      .describe(
        'Image build state. `null` when the deployment installs dependencies at run time and has nothing to build.'
      ),
    errorCode: z.string().nullable().describe('Classified build failure code, or `null`.'),
    errorMessage: z
      .string()
      .nullable()
      .describe('Human-readable build failure summary, or `null`.'),
    errorDetail: z
      .string()
      .nullable()
      .describe('Tail of the installer log for a failed build, or `null`.'),
    builtAt: v2TimestampSchema
      .nullable()
      .describe('ISO 8601 timestamp when the current image finished building, or `null`.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the sandbox was created.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 timestamp when the sandbox was last updated.'),
  })
  .meta({
    id: 'V2Sandbox',
    title: 'Sandbox',
    description:
      'A workspace sandbox: a reusable dependency set that Function blocks execute against.',
  })
export type V2Sandbox = z.output<typeof v2SandboxSchema>

export const v2SandboxDeleteDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted sandbox.'),
    deleted: z.literal(true).describe('Whether the sandbox was deleted.'),
  })
  .meta({
    id: 'V2SandboxDeleteData',
    title: 'Delete sandbox data',
    description: 'Sandbox deletion acknowledgement.',
  })
export type V2SandboxDeleteData = z.output<typeof v2SandboxDeleteDataSchema>

export const v2SandboxParamsSchema = z.object({
  sandboxId: nonEmptyIdSchema.describe('Unique sandbox identifier.'),
})
export type V2SandboxParams = z.output<typeof v2SandboxParamsSchema>

export const v2SandboxWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the sandbox.'),
  })
  .strict()
export type V2SandboxWorkspaceQuery = z.output<typeof v2SandboxWorkspaceQuerySchema>

export const v2SandboxSortFields = ['name', 'createdAt', 'updatedAt'] as const

export type V2SandboxSortBy = (typeof v2SandboxSortFields)[number]

export const v2ListSandboxesQuerySchema = v2SandboxWorkspaceQuerySchema
  .extend({
    search: v2SearchSchema.describe('Case-insensitive substring match against the sandbox name.'),
    ...v2SortFields(v2SandboxSortFields, { sortBy: 'name', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum sandboxes to return per page.' }),
  })
  .strict()

export type V2ListSandboxesQuery = z.output<typeof v2ListSandboxesQuerySchema>

export const v2CreateSandboxBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the sandbox.'),
    name: sandboxNameSchema.describe(
      'Display name, unique within the workspace; 1 to 64 characters.'
    ),
    language: sandboxLanguageSchema.describe(LANGUAGE_DESCRIPTION),
    dependencies: dependencyListSchema.default([]).describe(DEPENDENCIES_DESCRIPTION),
    cliTools: sandboxCliToolsSchema.default([]).describe(CLI_TOOLS_DESCRIPTION),
    systemPackages: systemPackageListSchema.default([]).describe(SYSTEM_PACKAGES_DESCRIPTION),
  })
  .strict()
export type V2CreateSandboxBody = z.input<typeof v2CreateSandboxBodySchema>

/** Update body. Omitted fields keep their stored values; a supplied list replaces the whole list. */
export const v2UpdateSandboxBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the sandbox.'),
    name: sandboxNameSchema
      .optional()
      .describe('New display name, unique within the workspace; 1 to 64 characters.'),
    language: sandboxLanguageSchema
      .optional()
      .describe(
        'Replacement dependency ecosystem. The whole spec is revalidated against it, so a Python dependency list does not survive a switch to JavaScript.'
      ),
    dependencies: dependencyListSchema
      .optional()
      .describe('Replacement package list; replaces the whole list.'),
    cliTools: sandboxCliToolsSchema
      .optional()
      .describe('Replacement managed CLI list; replaces the whole list.'),
    systemPackages: systemPackageListSchema
      .optional()
      .describe('Replacement Debian package list; replaces the whole list.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.name === undefined &&
      body.language === undefined &&
      body.dependencies === undefined &&
      body.cliTools === undefined &&
      body.systemPackages === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message:
          'At least one of name, language, dependencies, cliTools, or systemPackages is required',
      })
    }
  })
export type V2UpdateSandboxBody = z.input<typeof v2UpdateSandboxBodySchema>

/**
 * Sandbox list, keyset-paginated over the active sort. The set is small per
 * workspace, but each row carries its dependency lists and installer log tail,
 * so it pages like every other v2 resource list.
 */
export const v2ListSandboxesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/sandboxes',
  query: v2ListSandboxesQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2SandboxSchema),
  },
})

export const v2CreateSandboxContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/sandboxes',
  query: noInputSchema,
  body: v2CreateSandboxBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SandboxSchema),
    status: 201,
  },
})

export const v2GetSandboxContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/sandboxes/[sandboxId]',
  params: v2SandboxParamsSchema,
  query: v2SandboxWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SandboxSchema),
  },
})

export const v2UpdateSandboxContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/sandboxes/[sandboxId]',
  query: noInputSchema,
  params: v2SandboxParamsSchema,
  body: v2UpdateSandboxBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SandboxSchema),
  },
})

export const v2DeleteSandboxContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/sandboxes/[sandboxId]',
  params: v2SandboxParamsSchema,
  query: v2SandboxWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SandboxDeleteDataSchema),
  },
})
