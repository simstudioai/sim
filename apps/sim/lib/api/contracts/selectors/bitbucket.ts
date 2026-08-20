import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'

const BITBUCKET_API_ORIGIN = 'https://api.bitbucket.org'
const BITBUCKET_WORKSPACES_PATH = '/2.0/user/workspaces'
const BITBUCKET_REPOSITORIES_PATH = '/2.0/repositories'
const BITBUCKET_CURSOR_MAX_LENGTH = 4_096

export const BITBUCKET_SELECTOR_PAGE_SIZE = 100

const bitbucketSlugSchema = z
  .string()
  .trim()
  .min(1, 'Bitbucket slug is required')
  .max(255, 'Bitbucket slug must be 255 characters or fewer')

const bitbucketWorkspaceUuidPattern =
  /^(?:\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** Bitbucket workspace ids are alphanumeric with hyphens and underscores only. */
const bitbucketWorkspaceSlugPattern = /^[a-z0-9][a-z0-9_-]*$/i

const bitbucketWorkspaceSlugSchema = bitbucketSlugSchema.refine(
  (slug) => bitbucketWorkspaceSlugPattern.test(slug) && !bitbucketWorkspaceUuidPattern.test(slug),
  'Bitbucket workspace must be identified by its slug, not a UUID or path'
)

const bitbucketRepositorySlugSchema = bitbucketSlugSchema.refine(
  (slug) => slug.length <= 62,
  'Bitbucket repository slug must be 62 characters or fewer'
)

/**
 * Parses only absolute Bitbucket Cloud API URLs that are safe to receive an
 * OAuth bearer token. Userinfo, fragments, non-default ports, lookalike hosts,
 * and paths outside the v2 API are rejected.
 */
function parseBitbucketApiCursor(value: string): URL | null {
  try {
    const url = new URL(value)
    if (
      url.origin !== BITBUCKET_API_ORIGIN ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname.startsWith('/2.0/')
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

/** Validates a provider cursor for the authenticated user's workspace stream. */
export function isBitbucketWorkspacesCursor(value: string): boolean {
  return parseBitbucketApiCursor(value)?.pathname === BITBUCKET_WORKSPACES_PATH
}

/**
 * Validates a repository cursor against the workspace dependency selected in
 * the block, preventing a stale or crafted cursor from crossing workspaces.
 */
export function isBitbucketRepositoriesCursor(value: string, workspaceSlug: string): boolean {
  const url = parseBitbucketApiCursor(value)
  const expected = `${BITBUCKET_REPOSITORIES_PATH}/${encodeURIComponent(workspaceSlug)}`
  return url?.pathname.toLowerCase() === expected.toLowerCase()
}

const bitbucketCursorSchema = z
  .string()
  .min(1, 'Bitbucket cursor cannot be empty')
  .max(BITBUCKET_CURSOR_MAX_LENGTH, 'Bitbucket cursor is too long')

export const bitbucketWorkspacesBodySchema = credentialWorkflowBodySchema.extend({
  cursor: bitbucketCursorSchema
    .refine(isBitbucketWorkspacesCursor, 'Invalid Bitbucket workspaces cursor')
    .optional(),
})

export const bitbucketRepositoriesBodySchema = credentialWorkflowBodySchema
  .extend({
    workspaceSlug: bitbucketWorkspaceSlugSchema,
    cursor: bitbucketCursorSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.cursor && !isBitbucketRepositoriesCursor(body.cursor, body.workspaceSlug)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'Invalid Bitbucket repositories cursor',
      })
    }
  })

const bitbucketUuidSchema = z.string().trim().min(1).max(100)
const bitbucketNameSchema = z.string().trim().min(1).max(512)

const bitbucketWorkspaceProviderSchema = z
  .object({
    administrator: z.boolean(),
    workspace: z
      .object({
        slug: bitbucketSlugSchema,
        uuid: bitbucketUuidSchema,
        name: bitbucketNameSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough()

const bitbucketRepositoryProviderSchema = z
  .object({
    slug: bitbucketRepositorySlugSchema.optional(),
    uuid: bitbucketUuidSchema,
    name: bitbucketNameSchema.optional(),
    full_name: bitbucketNameSchema,
  })
  .passthrough()
  .refine((repository) => {
    const slash = repository.full_name.indexOf('/')
    if (slash <= 0 || slash !== repository.full_name.lastIndexOf('/')) return false
    const fullNameSlug = repository.full_name.slice(slash + 1)
    return (
      bitbucketRepositorySlugSchema.safeParse(fullNameSlug).success &&
      (!repository.slug || repository.slug === fullNameSlug)
    )
  }, 'Bitbucket repository full_name does not match its slug')
  .transform((repository) => ({
    ...repository,
    slug: repository.slug ?? repository.full_name.slice(repository.full_name.indexOf('/') + 1),
  }))

/** Strictly narrows the untrusted Bitbucket Cloud workspace page. */
export const bitbucketWorkspaceProviderPageSchema = z
  .object({
    values: z.array(bitbucketWorkspaceProviderSchema).max(BITBUCKET_SELECTOR_PAGE_SIZE),
    next: bitbucketCursorSchema.optional(),
  })
  .passthrough()

/** Strictly narrows the untrusted Bitbucket Cloud repository page. */
export const bitbucketRepositoryProviderPageSchema = z
  .object({
    values: z.array(bitbucketRepositoryProviderSchema).max(BITBUCKET_SELECTOR_PAGE_SIZE),
    next: bitbucketCursorSchema.optional(),
  })
  .passthrough()

const bitbucketWorkspaceSchema = z.object({
  slug: bitbucketSlugSchema,
  uuid: bitbucketUuidSchema,
  name: bitbucketNameSchema,
  administrator: z.boolean(),
})

const bitbucketRepositorySchema = z.object({
  slug: bitbucketRepositorySlugSchema,
  uuid: bitbucketUuidSchema,
  name: bitbucketNameSchema,
  fullName: bitbucketNameSchema,
})

export const bitbucketWorkspacesSelectorContract = definePostSelector(
  '/api/tools/bitbucket/workspaces',
  bitbucketWorkspacesBodySchema,
  z.object({
    workspaces: z.array(bitbucketWorkspaceSchema).max(BITBUCKET_SELECTOR_PAGE_SIZE),
    nextCursor: optionalString,
  })
)

export const bitbucketRepositoriesSelectorContract = definePostSelector(
  '/api/tools/bitbucket/repositories',
  bitbucketRepositoriesBodySchema,
  z.object({
    repositories: z.array(bitbucketRepositorySchema).max(BITBUCKET_SELECTOR_PAGE_SIZE),
    nextCursor: optionalString,
  })
)

export type BitbucketWorkspacesSelectorBody = ContractBody<
  typeof bitbucketWorkspacesSelectorContract
>
export type BitbucketRepositoriesSelectorBody = ContractBody<
  typeof bitbucketRepositoriesSelectorContract
>
export type BitbucketWorkspacesSelectorResponse = ContractJsonResponse<
  typeof bitbucketWorkspacesSelectorContract
>
export type BitbucketRepositoriesSelectorResponse = ContractJsonResponse<
  typeof bitbucketRepositoriesSelectorContract
>
