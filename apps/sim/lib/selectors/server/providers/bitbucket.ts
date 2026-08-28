import { z } from 'zod'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type BitbucketSelectorKey = Extract<
  ServerSelectorKey,
  'bitbucket.workspaces' | 'bitbucket.repositories'
>

const BITBUCKET_API_ORIGIN = 'https://api.bitbucket.org'
const BITBUCKET_WORKSPACES_PATH = '/2.0/user/workspaces'
const BITBUCKET_REPOSITORIES_PATH = '/2.0/repositories'
const BITBUCKET_PAGE_SIZE = 100
const BITBUCKET_CURSOR_MAX_LENGTH = 4_096
const BITBUCKET_WORKSPACE_FIELDS =
  'values.administrator,values.workspace.slug,values.workspace.uuid,values.workspace.name,next'
const BITBUCKET_REPOSITORY_FIELDS = 'values.slug,values.uuid,values.name,values.full_name,next'

const bitbucketSlugSchema = z.string().trim().min(1).max(255)
const bitbucketUuidSchema = z.string().trim().min(1).max(100)
const bitbucketNameSchema = z.string().trim().min(1).max(512)
const workspaceUuidPattern =
  /^(?:\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const workspaceSlugPattern = /^[a-z0-9][a-z0-9_-]*$/i

const workspaceSlugSchema = bitbucketSlugSchema.refine(
  (slug) => workspaceSlugPattern.test(slug) && !workspaceUuidPattern.test(slug)
)
const repositorySlugSchema = bitbucketSlugSchema.max(62)

const workspacePageSchema = z.object({
  values: z
    .array(
      z.object({
        administrator: z.boolean(),
        workspace: z.object({
          slug: workspaceSlugSchema,
          uuid: bitbucketUuidSchema,
          name: bitbucketNameSchema.optional(),
        }),
      })
    )
    .max(BITBUCKET_PAGE_SIZE),
  next: z.string().min(1).max(BITBUCKET_CURSOR_MAX_LENGTH).optional(),
})

const repositoryPageSchema = z.object({
  values: z
    .array(
      z.object({
        slug: repositorySlugSchema.optional(),
        uuid: bitbucketUuidSchema,
        name: bitbucketNameSchema.optional(),
        full_name: bitbucketNameSchema,
      })
    )
    .max(BITBUCKET_PAGE_SIZE),
  next: z.string().min(1).max(BITBUCKET_CURSOR_MAX_LENGTH).optional(),
})

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

function requireWorkspaceSlug(value: string | undefined): string {
  const parsed = workspaceSlugSchema.safeParse(value)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

function requireCursorParams(cursor: string): URLSearchParams {
  if (!cursor || cursor.length > BITBUCKET_CURSOR_MAX_LENGTH) {
    throw new SelectorContextUnavailableError()
  }

  const input = new URLSearchParams(cursor)
  const output = new URLSearchParams()
  for (const [key, value] of input) {
    if (key === 'page') {
      if (!/^[1-9][0-9]{0,8}$/.test(value) || output.has(key)) {
        throw new SelectorContextUnavailableError()
      }
      output.set(key, value)
      continue
    }
    if (key === 'after') {
      if (!value || value.length > 512 || output.has(key)) {
        throw new SelectorContextUnavailableError()
      }
      output.set(key, value)
      continue
    }
    throw new SelectorContextUnavailableError()
  }

  if (output.size === 0) throw new SelectorContextUnavailableError()
  return output
}

function encodeNextCursor(next: string, expectedPath: string): string {
  let url: URL
  try {
    url = new URL(next)
  } catch {
    throw new SelectorOptionsUnavailableError()
  }

  if (
    url.origin !== BITBUCKET_API_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname.toLowerCase() !== expectedPath.toLowerCase()
  ) {
    throw new SelectorOptionsUnavailableError()
  }

  const cursor = new URLSearchParams()
  for (const [key, value] of url.searchParams) {
    if (key === 'page' || key === 'after') cursor.append(key, value)
    else if (key === 'pagelen' && value !== String(BITBUCKET_PAGE_SIZE)) {
      throw new SelectorOptionsUnavailableError()
    }
  }

  try {
    return requireCursorParams(cursor.toString()).toString()
  } catch {
    throw new SelectorOptionsUnavailableError()
  }
}

function buildPageUrl(path: string, fields: string, cursor: string | undefined): URL {
  const url = new URL(path, BITBUCKET_API_ORIGIN)
  url.searchParams.set('pagelen', String(BITBUCKET_PAGE_SIZE))
  url.searchParams.set('fields', fields)
  if (cursor) {
    for (const [key, value] of requireCursorParams(cursor)) {
      url.searchParams.set(key, value)
    }
  }
  return url
}

async function getAccessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  return resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'bitbucket',
    protectedValues: args.protectedValues,
  })
}

async function listWorkspaces(args: ExecuteServerSelectorArgs) {
  const request = requireListRequest(args.selectorKey, args.request)
  const url = buildPageUrl(BITBUCKET_WORKSPACES_PATH, BITBUCKET_WORKSPACE_FIELDS, request.cursor)
  const accessToken = await getAccessToken(args)
  const body = await fetchProviderJson<unknown>(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = workspacePageSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()

  return listSelectorResult(
    parsed.data.values.map(({ administrator, workspace }) => ({
      id: workspace.slug,
      label: workspace.name ?? workspace.slug,
      meta: {
        slug: workspace.slug,
        uuid: workspace.uuid,
        fullName: workspace.name ?? workspace.slug,
        administrator,
      },
    })),
    parsed.data.next ? encodeNextCursor(parsed.data.next, BITBUCKET_WORKSPACES_PATH) : undefined
  )
}

async function listRepositories(args: ExecuteServerSelectorArgs) {
  const request = requireListRequest(args.selectorKey, args.request)
  const workspaceSlug = requireWorkspaceSlug(args.context.workspaceSlug)
  const path = `${BITBUCKET_REPOSITORIES_PATH}/${workspaceSlug}`
  const url = buildPageUrl(path, BITBUCKET_REPOSITORY_FIELDS, request.cursor)
  const accessToken = await getAccessToken(args)
  const body = await fetchProviderJson<unknown>(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = repositoryPageSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()

  const normalized = parsed.data.values.map((repository) => {
    const separator = repository.full_name.indexOf('/')
    if (separator <= 0 || separator !== repository.full_name.lastIndexOf('/')) {
      throw new SelectorOptionsUnavailableError()
    }
    const responseWorkspace = repository.full_name.slice(0, separator)
    const fullNameSlug = repository.full_name.slice(separator + 1)
    const slug = repository.slug ?? fullNameSlug
    if (
      responseWorkspace.toLowerCase() !== workspaceSlug.toLowerCase() ||
      slug !== fullNameSlug ||
      !repositorySlugSchema.safeParse(slug).success
    ) {
      throw new SelectorOptionsUnavailableError()
    }

    const meta = {
      slug,
      uuid: repository.uuid,
      ...(!args.references.has('workspaceSlug')
        ? { fullName: repository.full_name, workspaceSlug }
        : {}),
    }
    return {
      id: slug,
      label: repository.name ?? slug,
      meta,
    }
  })

  return listSelectorResult(
    normalized,
    parsed.data.next ? encodeNextCursor(parsed.data.next, path) : undefined
  )
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['bitbucket'],
} as const

export const bitbucketSelectorAttachments = {
  'bitbucket.workspaces': {
    credential,
    destination: 'fixed',
    execute: listWorkspaces,
  },
  'bitbucket.repositories': {
    credential,
    destination: 'fixed',
    execute: listRepositories,
  },
} satisfies ServerSelectorAttachmentMap<BitbucketSelectorKey>
