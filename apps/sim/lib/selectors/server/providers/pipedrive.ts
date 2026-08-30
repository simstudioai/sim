import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type { ServerSelectorAttachmentMap } from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { getPipedriveAuthHeaders } from '@/tools/pipedrive/utils'

type PipedriveSelectorKey = Extract<ServerSelectorKey, 'pipedrive.pipelines'>

interface PipedrivePage {
  data?: Array<{ id: number | string; name: string }>
  additional_data?: {
    pagination?: { more_items_in_collection?: boolean; next_start?: number }
  }
}

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
      let start = 0
      let truncated = false
      for (let page = 0; page < 50; page++) {
        const url = new URL('https://api.pipedrive.com/v1/pipelines')
        url.searchParams.set('start', String(start))
        url.searchParams.set('limit', '500')
        const data = await fetchProviderJson<PipedrivePage>(url, {
          headers: getPipedriveAuthHeaders({
            accessToken: token.accessToken,
            authStyle: token.authStyle,
          }),
          signal: args.signal,
          redirect: 'error',
        })
        for (const pipeline of data.data ?? []) {
          items.push({ id: String(pipeline.id), label: pipeline.name })
        }
        const pagination = data.additional_data?.pagination
        if (!pagination?.more_items_in_collection || typeof pagination.next_start !== 'number') {
          break
        }
        start = pagination.next_start
        if (page === 49) truncated = true
      }
      return flatSelectorResult(
        args.request,
        items,
        true,
        truncated ? { truncated: { reason: 'provider-cap', pages: 50 } } : undefined
      )
    },
  },
} satisfies ServerSelectorAttachmentMap<PipedriveSelectorKey>
