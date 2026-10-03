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

type CalcomSelectorKey = Extract<ServerSelectorKey, 'calcom.eventTypes' | 'calcom.schedules'>

const calcomIdSchema = z.union([z.string().min(1), z.number().finite()]).transform(String)

const eventTypesResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: calcomIdSchema,
        title: z.string(),
        slug: z.string().min(1),
      })
    )
    .max(10_000)
    .optional(),
})

const schedulesResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: calcomIdSchema,
        name: z.string().min(1),
      })
    )
    .max(10_000)
    .optional(),
})

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

async function getAccessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  return resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'calcom',
    protectedValues: args.protectedValues,
  })
}

async function getOptions(args: ExecuteServerSelectorArgs, kind: 'event-types' | 'schedules') {
  const accessToken = await getAccessToken(args)
  const body = await fetchProviderJson<unknown>(`https://api.cal.com/v2/${kind}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'cal-api-version': kind === 'event-types' ? '2024-06-14' : '2024-06-11',
    },
    redirect: 'error',
    signal: args.signal,
  })

  if (kind === 'event-types') {
    const parsed = eventTypesResponseSchema.safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()
    return (parsed.data.data ?? []).map((eventType) => ({
      id: eventType.id,
      label: eventType.title || eventType.slug,
    }))
  }

  const parsed = schedulesResponseSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return (parsed.data.data ?? []).map((schedule) => ({
    id: schedule.id,
    label: schedule.name,
  }))
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['calcom'],
} as const

export const calcomSelectorAttachments = {
  'calcom.eventTypes': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return flatSelectorResult(args.request, await getOptions(args, 'event-types'), true)
    },
  },
  'calcom.schedules': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return flatSelectorResult(args.request, await getOptions(args, 'schedules'), true)
    },
  },
} satisfies ServerSelectorAttachmentMap<CalcomSelectorKey>
