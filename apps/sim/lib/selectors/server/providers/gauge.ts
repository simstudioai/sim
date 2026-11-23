import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
} from '@/lib/selectors/server/providers/http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachment,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { safeUrlPathSegment } from '@/tools/url-path'

type GaugeSelectorKey = Extract<ServerSelectorKey, `gauge.${string}`>

const GAUGE_API_BASE = 'https://app.withgauge.com/api/v1'
const GAUGE_PAGE_SIZE = 200

const namedSchema = z.object({ id: z.string().min(1).max(512), name: z.string() })
const organizationSchema = namedSchema.extend({ products: z.object({ chat: z.boolean() }) })
const topicSchema = z.object({ id: z.string().min(1).max(512), title: z.string() })
const promptSchema = z.object({ id: z.string().min(1).max(512), text: z.string() })
const answerSchema = promptSchema.extend({
  model: z.string(),
  day: z.string(),
  promptId: z.string().min(1).max(512),
})

function segment(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new SelectorContextUnavailableError()
  try {
    return safeUrlPathSegment(value, field)
  } catch {
    throw new SelectorContextUnavailableError()
  }
}

function organizationPath(args: ExecuteServerSelectorArgs): string {
  return `/orgs/${segment(args.context.organization, 'organization')}`
}

function categoryPath(args: ExecuteServerSelectorArgs): string {
  return `${organizationPath(args)}/categories/${segment(args.context.category, 'category')}`
}

function namedOption(item: z.infer<typeof namedSchema>): SafeSelectorOption {
  return { id: item.id, label: truncate(item.name.trim() || item.id, 200) }
}

function answerOption(item: z.infer<typeof answerSchema>): SafeSelectorOption {
  return {
    id: item.id,
    label: truncate(`${item.day} · ${item.model} · ${item.text}`, 200),
    meta: { promptId: item.promptId, model: item.model, day: item.day },
  }
}

function resourceAttachment<T extends z.ZodType>(input: {
  path(args: ExecuteServerSelectorArgs): string
  schema: T
  toOption(item: z.infer<T>): SafeSelectorOption | null
  paginated?: boolean
  pageSize?: number
  allTrackingTypes?: boolean
}): ServerSelectorAttachment {
  return {
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['gauge'] },
    integrationBlockTypes: ['gauge'],
    destination: 'fixed',
    execute: async (args) => {
      const pageSize = input.pageSize ?? GAUGE_PAGE_SIZE
      const path = input.path(args)
      const url = new URL(`${GAUGE_API_BASE}${path}`)
      if (args.request.kind === 'detail') {
        url.pathname += `/${segment(args.request.id, 'resourceId')}`
      } else if (input.paginated) {
        url.searchParams.set('limit', String(pageSize))
        if (input.allTrackingTypes) url.searchParams.set('trackingType', 'all')
        if (args.request.cursor !== undefined) {
          url.searchParams.set('cursor', args.request.cursor)
        }
      }

      const { accessToken } = await resolveSelectorCredentialBundle({
        credential: args.credential,
        protectedValues: args.protectedValues,
      })
      const request = {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: args.signal,
      }
      if (args.request.kind === 'detail') {
        const result = await fetchProviderJsonWithStatus<unknown>(url, request, {
          passthroughStatuses: [404],
        })
        if (!result.ok) return detailSelectorResult(null)
        const parsed = input.schema.safeParse(result.data)
        if (!parsed.success) throw new SelectorOptionsUnavailableError()
        return detailSelectorResult(input.toOption(parsed.data))
      }

      const body = await fetchProviderJson<unknown>(url, request)
      const parsed = z
        .object({
          data: z.array(input.schema).max(input.paginated ? pageSize : MAX_SELECTOR_OPTIONS),
          nextCursor: z.string().nullish(),
        })
        .safeParse(body)
      if (!parsed.success || (!input.paginated && parsed.data.nextCursor)) {
        throw new SelectorOptionsUnavailableError()
      }
      const items = parsed.data.data
        .map(input.toOption)
        .filter((option): option is SafeSelectorOption => option !== null)
      return listSelectorResult(items, parsed.data.nextCursor ?? undefined)
    },
  }
}

export const gaugeSelectorAttachments = {
  'gauge.organizations': resourceAttachment({
    path: () => '/orgs',
    schema: organizationSchema,
    toOption: (item) => (item.products.chat ? namedOption(item) : null),
  }),
  'gauge.categories': resourceAttachment({
    path: (args) => `${organizationPath(args)}/categories`,
    schema: namedSchema,
    toOption: namedOption,
  }),
  'gauge.topics': resourceAttachment({
    path: (args) => `${categoryPath(args)}/topics`,
    schema: topicSchema,
    toOption: (item) => ({ id: item.id, label: truncate(item.title.trim() || item.id, 200) }),
    paginated: true,
  }),
  'gauge.prompts': resourceAttachment({
    path: (args) => `${categoryPath(args)}/prompts`,
    schema: promptSchema,
    toOption: (item) => ({ id: item.id, label: truncate(item.text.trim() || item.id, 200) }),
    paginated: true,
    allTrackingTypes: true,
  }),
  'gauge.tags': resourceAttachment({
    path: (args) => `${organizationPath(args)}/tags`,
    schema: namedSchema,
    toOption: namedOption,
  }),
  'gauge.answers': resourceAttachment({
    path: (args) => `${categoryPath(args)}/answers`,
    schema: answerSchema,
    toOption: answerOption,
    paginated: true,
    pageSize: 100,
    allTrackingTypes: true,
  }),
} satisfies ServerSelectorAttachmentMap<GaugeSelectorKey>
