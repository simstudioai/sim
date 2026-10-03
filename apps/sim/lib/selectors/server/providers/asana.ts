import { z } from 'zod'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type AsanaSelectorKey = Extract<ServerSelectorKey, 'asana.workspaces'>

const ASANA_WORKSPACES_URL = 'https://app.asana.com/api/1.0/workspaces'
const ASANA_PAGE_LIMIT = 100
const ASANA_MAX_PAGES = 50

const asanaWorkspaceSchema = z.object({
  gid: z.string().min(1),
  name: z.string().min(1),
})

const asanaPageSchema = z.object({
  data: z.array(asanaWorkspaceSchema).max(ASANA_PAGE_LIMIT).optional(),
  next_page: z
    .object({ offset: z.string().min(1).max(4_096) })
    .nullable()
    .optional(),
})

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

async function listWorkspaces(args: ExecuteServerSelectorArgs) {
  const accessToken = await resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'asana',
    protectedValues: args.protectedValues,
  })
  const workspaces: z.infer<typeof asanaWorkspaceSchema>[] = []
  let offset: string | undefined
  let truncated = false

  for (let page = 0; page < ASANA_MAX_PAGES; page++) {
    const url = new URL(ASANA_WORKSPACES_URL)
    url.searchParams.set('limit', String(ASANA_PAGE_LIMIT))
    if (offset) url.searchParams.set('offset', offset)

    const body = await fetchProviderJson<unknown>(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: args.signal,
    })
    const parsed = asanaPageSchema.safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()

    workspaces.push(...(parsed.data.data ?? []))
    offset = parsed.data.next_page?.offset
    if (!offset) break
    if (page === ASANA_MAX_PAGES - 1) truncated = true
  }

  return {
    items: workspaces.map((workspace) => ({ id: workspace.gid, label: workspace.name })),
    truncated,
  }
}

export const asanaSelectorAttachments = {
  'asana.workspaces': {
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['asana'],
    },
    destination: 'fixed',
    async execute(args) {
      const { items, truncated } = await listWorkspaces(args)
      return flatSelectorResult(
        args.request,
        items,
        true,
        truncated ? { truncated: { reason: 'provider-cap', pages: ASANA_MAX_PAGES } } : undefined
      )
    },
  },
} satisfies ServerSelectorAttachmentMap<AsanaSelectorKey>
