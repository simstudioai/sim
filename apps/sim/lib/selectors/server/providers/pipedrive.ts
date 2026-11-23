import { z } from 'zod'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { appendSelectorOptions } from '@/lib/selectors/server/option-budget'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/http'
import type { ServerSelectorAttachmentMap } from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { getPipedriveAuthHeaders } from '@/tools/pipedrive/utils'

type PipedriveSelectorKey = Extract<ServerSelectorKey, 'pipedrive.pipelines'>

const PAGE_SIZE = 500
const MAX_PAGES = 50

const pipedrivePageSchema = z.object({
  success: z.literal(true),
  data: z.array(
    z.object({
      id: z.union([z.number().finite(), z.string().min(1)]),
      name: z.string().min(1),
    })
  ),
  additional_data: z
    .object({
      next_cursor: z.string().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
})

export const pipedriveSelectorAttachments = {
  'pipedrive.pipelines': {
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['pipedrive'],
    },
    destination: 'fixed',
    execute: async (args) => {
      if (!args.credential) throw new SelectorConnectionUnavailableError()
      const token = await resolveSelectorCredentialBundle({
        credential: args.credential,
        protectedValues: args.protectedValues,
      })
      const items: SafeSelectorOption[] = []
      let cursor: string | undefined
      let truncated = false
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL('https://api.pipedrive.com/api/v2/pipelines')
        url.searchParams.set('limit', String(PAGE_SIZE))
        if (cursor) url.searchParams.set('cursor', cursor)
        const body = await fetchProviderJson<unknown>(url, {
          headers: getPipedriveAuthHeaders({
            accessToken: token.accessToken,
            authStyle: token.authStyle === 'x-api-token' ? token.authStyle : undefined,
          }),
          signal: args.signal,
          redirect: 'error',
        })
        const parsed = pipedrivePageSchema.safeParse(body)
        if (!parsed.success) throw new SelectorOptionsUnavailableError()
        const data = parsed.data
        const appended = appendSelectorOptions(
          items,
          (data.data ?? []).map((pipeline) => ({
            id: String(pipeline.id),
            label: pipeline.name,
          }))
        )
        const nextCursor = data.additional_data?.next_cursor
        if (!nextCursor) {
          if (appended.overflow) truncated = true
          break
        }
        if (appended.full) {
          truncated = true
          break
        }
        cursor = nextCursor
        if (page === MAX_PAGES - 1) truncated = true
      }
      return flatSelectorResult(
        args.request,
        items,
        true,
        truncated
          ? {
              truncated: {
                reason: 'provider-cap',
                limit: MAX_SELECTOR_OPTIONS,
                pages: MAX_PAGES,
              },
            }
          : undefined
      )
    },
  },
} satisfies ServerSelectorAttachmentMap<PipedriveSelectorKey>
