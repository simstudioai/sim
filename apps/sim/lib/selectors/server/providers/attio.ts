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

type AttioSelectorKey = Extract<ServerSelectorKey, 'attio.lists' | 'attio.objects'>

const attioListSchema = z.object({
  api_slug: z.string().min(1),
  name: z.string().min(1),
})

const attioObjectSchema = z.object({
  api_slug: z.string().min(1),
  singular_noun: z.string().min(1),
})

function responseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item).max(10_000).optional() })
}

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

async function accessToken(args: ExecuteServerSelectorArgs) {
  return resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'attio',
    protectedValues: args.protectedValues,
  })
}

async function fetchAttioOptions(args: ExecuteServerSelectorArgs, kind: 'lists' | 'objects') {
  const token = await accessToken(args)
  const body = await fetchProviderJson<unknown>(`https://api.attio.com/v2/${kind}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    redirect: 'error',
    signal: args.signal,
  })

  if (kind === 'lists') {
    const parsed = responseSchema(attioListSchema).safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()
    return (parsed.data.data ?? []).map((list) => ({ id: list.api_slug, label: list.name }))
  }

  const parsed = responseSchema(attioObjectSchema).safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return (parsed.data.data ?? []).map((object) => ({
    id: object.api_slug,
    label: object.singular_noun,
  }))
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['attio'],
} as const

export const attioSelectorAttachments = {
  'attio.lists': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return flatSelectorResult(args.request, await fetchAttioOptions(args, 'lists'), true)
    },
  },
  'attio.objects': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return flatSelectorResult(args.request, await fetchAttioOptions(args, 'objects'), true)
    },
  },
} satisfies ServerSelectorAttachmentMap<AttioSelectorKey>
