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
import { CLICKUP_API_BASE_URL, clickupAuthorizationHeader } from '@/tools/clickup/shared'

type ClickupSelectorKey = Extract<
  ServerSelectorKey,
  'clickup.workspaces' | 'clickup.spaces' | 'clickup.folders' | 'clickup.lists'
>

const clickupResourceSchema = z.object({
  id: z.union([z.string().min(1), z.number().finite()]).transform(String),
  name: z.string().optional(),
})

const clickupResponseSchema = z.object({
  teams: z.array(clickupResourceSchema).max(10_000).optional(),
  spaces: z.array(clickupResourceSchema).max(10_000).optional(),
  folders: z.array(clickupResourceSchema).max(10_000).optional(),
  lists: z.array(clickupResourceSchema).max(10_000).optional(),
})

type ClickupResponseField = 'teams' | 'spaces' | 'folders' | 'lists'

const fallbackLabels: Record<ClickupResponseField, string> = {
  teams: 'Workspace',
  spaces: 'Space',
  folders: 'Folder',
  lists: 'List',
}

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

function requireClickupId(value: string | undefined): string {
  if (!value || value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SelectorContextUnavailableError()
  }
  return value
}

async function getAccessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  return resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'clickup',
    protectedValues: args.protectedValues,
  })
}

async function fetchClickupOptions(
  args: ExecuteServerSelectorArgs,
  field: ClickupResponseField,
  path: string
) {
  requireListRequest(args.selectorKey, args.request)
  const accessToken = await getAccessToken(args)
  const body = await fetchProviderJson<unknown>(`${CLICKUP_API_BASE_URL}${path}`, {
    headers: {
      Authorization: clickupAuthorizationHeader(accessToken),
      Accept: 'application/json',
    },
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = clickupResponseSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()

  const resources = parsed.data[field]
  return (resources ?? []).map((resource) => ({
    id: resource.id,
    label: resource.name || `${fallbackLabels[field]} ${resource.id}`,
  }))
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['clickup'],
} as const

export const clickupSelectorAttachments = {
  'clickup.workspaces': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return listSelectorResult(await fetchClickupOptions(args, 'teams', '/team'))
    },
  },
  'clickup.spaces': {
    credential,
    destination: 'fixed',
    async execute(args) {
      const teamId = requireClickupId(args.context.teamId)
      return listSelectorResult(
        await fetchClickupOptions(args, 'spaces', `/team/${encodeURIComponent(teamId)}/space`)
      )
    },
  },
  'clickup.folders': {
    credential,
    destination: 'fixed',
    async execute(args) {
      const spaceId = requireClickupId(args.context.spaceId || args.context.listSpaceId)
      return listSelectorResult(
        await fetchClickupOptions(args, 'folders', `/space/${encodeURIComponent(spaceId)}/folder`)
      )
    },
  },
  'clickup.lists': {
    credential,
    destination: 'fixed',
    async execute(args) {
      const folderId = args.context.folderId
      const spaceId = args.context.spaceId
      const path = folderId
        ? `/folder/${encodeURIComponent(requireClickupId(folderId))}/list`
        : `/space/${encodeURIComponent(requireClickupId(spaceId))}/list`
      return listSelectorResult(await fetchClickupOptions(args, 'lists', path))
    },
  },
} satisfies ServerSelectorAttachmentMap<ClickupSelectorKey>
