import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type ZoomSelectorKey = Extract<ServerSelectorKey, 'zoom.meetings'>

const PAGE_SIZE = 300

interface ZoomMeetingsPage {
  meetings?: Array<{ id: number | string; topic?: string }>
  next_page_token?: string
}

interface ZoomMeeting {
  id: number | string
  topic?: string
}

function encodeZoomMeetingId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 256 || /[\u0000-\u001F\u007F]/.test(id)) {
    throw new SelectorContextUnavailableError()
  }
  const encoded = encodeURIComponent(id)
  return id.startsWith('/') || id.includes('//') ? encodeURIComponent(encoded) : encoded
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
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      if (args.request.kind === 'detail') {
        const meeting = await fetchProviderJson<ZoomMeeting>(
          `https://api.zoom.us/v2/meetings/${encodeZoomMeetingId(args.request.id)}`,
          { headers, signal: args.signal, redirect: 'error' }
        )
        const id = String(meeting.id)
        return detailSelectorResult({ id, label: meeting.topic || `Meeting ${id}` })
      }

      const request = requireListRequest(args.selectorKey, args.request)
      const url = new URL('https://api.zoom.us/v2/users/me/meetings')
      url.searchParams.set('page_size', String(PAGE_SIZE))
      url.searchParams.set('type', 'scheduled')
      if (request.cursor) url.searchParams.set('next_page_token', request.cursor)
      const data = await fetchProviderJson<ZoomMeetingsPage>(url, {
        headers,
        signal: args.signal,
        redirect: 'error',
      })
      return listSelectorResult(
        (data.meetings ?? []).map((meeting) => {
          const id = String(meeting.id)
          return { id, label: meeting.topic || `Meeting ${id}` }
        }),
        data.next_page_token?.trim() || undefined
      )
    },
  },
} satisfies ServerSelectorAttachmentMap<ZoomSelectorKey>
