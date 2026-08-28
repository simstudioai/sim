import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type { ServerSelectorAttachmentMap } from '@/lib/selectors/server/types'

type WealthboxSelectorKey = Extract<ServerSelectorKey, 'wealthbox.contacts'>

const PAGE_SIZE = 50
const MAX_PAGES = 50

interface WealthboxContactsPage {
  contacts?: Array<Record<string, unknown>>
  meta?: { total_pages?: number; current_page?: number }
}

export const wealthboxSelectorAttachments = {
  'wealthbox.contacts': {
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['wealthbox'],
    },
    destination: 'fixed',
    execute: async (args) => {
      if (!args.credential) throw new SelectorConnectionUnavailableError()
      const token = await resolveSelectorOAuthAccessToken({
        credential: args.credential,
        serviceId: 'wealthbox',
        protectedValues: args.protectedValues,
      })
      const contacts: Array<Record<string, unknown>> = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = new URL('https://api.crmworkspace.com/v1/contacts')
        url.searchParams.set('per_page', String(PAGE_SIZE))
        url.searchParams.set('page', String(page))
        const data = await fetchProviderJson<WealthboxContactsPage>(url, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: args.signal,
          redirect: 'error',
        })
        const pageContacts = Array.isArray(data.contacts) ? data.contacts : []
        contacts.push(...pageContacts)
        const totalPages = data.meta?.total_pages
        const currentPage = data.meta?.current_page ?? page
        if (
          (typeof totalPages === 'number' && totalPages > 0 && currentPage >= totalPages) ||
          pageContacts.length < PAGE_SIZE
        ) {
          break
        }
      }
      const search =
        args.request.kind === 'list' ? args.request.search?.trim().toLowerCase() : undefined
      const items = contacts.flatMap((contact) => {
        const id = contact.id === undefined || contact.id === null ? '' : String(contact.id)
        if (!id) return []
        const firstName = typeof contact.first_name === 'string' ? contact.first_name : ''
        const lastName = typeof contact.last_name === 'string' ? contact.last_name : ''
        const label = `${firstName} ${lastName}`.trim() || `Contact ${id}`
        const content =
          typeof contact.background_information === 'string' ? contact.background_information : ''
        if (
          search &&
          !label.toLowerCase().includes(search) &&
          !content.toLowerCase().includes(search)
        ) {
          return []
        }
        return [{ id, label }]
      })
      return flatSelectorResult(args.request, items)
    },
  },
} satisfies ServerSelectorAttachmentMap<WealthboxSelectorKey>
