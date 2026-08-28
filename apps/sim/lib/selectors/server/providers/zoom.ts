import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type { ServerSelectorAttachmentMap } from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type ZoomSelectorKey = Extract<ServerSelectorKey, 'zoom.meetings'>

const PAGE_SIZE = 300
const MAX_PAGES = 50

interface ZoomMeetingsPage {
  meetings?: Array<{ id: number | string; topic?: string }>
  next_page_token?: string
}

export const zoomSelectorAttachments = {
  'zoom.meetings': {
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['zoom'],
    },
    destination: 'fixed',
    execute: async (args) => {
      if (!args.credential) throw new SelectorConnectionUnavailableError()
      const token = await resolveSelectorOAuthAccessToken({
        credential: args.credential,
        serviceId: 'zoom',
        protectedValues: args.protectedValues,
      })
      const meetings: SafeSelectorOption[] = []
      let nextPageToken = ''
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL('https://api.zoom.us/v2/users/me/meetings')
        url.searchParams.set('page_size', String(PAGE_SIZE))
        url.searchParams.set('type', 'scheduled')
        if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken)
        const data = await fetchProviderJson<ZoomMeetingsPage>(url, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: args.signal,
          redirect: 'error',
        })
        for (const meeting of data.meetings ?? []) {
          const id = String(meeting.id)
          meetings.push({ id, label: meeting.topic || `Meeting ${id}` })
        }
        nextPageToken = data.next_page_token?.trim() ?? ''
        if (!nextPageToken) break
      }
      return flatSelectorResult(args.request, meetings, true)
    },
  },
} satisfies ServerSelectorAttachmentMap<ZoomSelectorKey>
