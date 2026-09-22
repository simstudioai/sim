import { createParser, parseAsStringLiteral } from 'nuqs/server'
import {
  ACCESS_REQUEST_LIST_PAGE_SIZE,
  ACCESS_REQUEST_MAX_ID_LENGTH,
  ACCESS_REQUEST_MAX_OFFSET,
  ACCESS_REQUEST_MAX_SEARCH_LENGTH,
} from '@/ee/access-requests/lib/constants'

const accessRequestPageParser = createParser({
  parse(value) {
    if (!/^\d+$/.test(value)) return null
    const page = Number(value)
    return Number.isSafeInteger(page) &&
      page <= Math.floor(ACCESS_REQUEST_MAX_OFFSET / ACCESS_REQUEST_LIST_PAGE_SIZE)
      ? page
      : null
  },
  serialize: String,
}).withDefault(0)

const accessRequestSearchParser = createParser({
  parse: (value) => (value.length <= ACCESS_REQUEST_MAX_SEARCH_LENGTH ? value : null),
  serialize: String,
}).withDefault('')

/** Missing IDs mean no request selection or organization context, so there is no default. */
const accessRequestIdParser = createParser({
  parse: (value) =>
    value.length > 0 && value.length <= ACCESS_REQUEST_MAX_ID_LENGTH ? value : null,
  serialize: String,
})

export const accessRequestSearchParams = {
  view: parseAsStringLiteral(['requests', 'catalog'] as const).withDefault('requests'),
  search: accessRequestSearchParser,
  requestId: accessRequestIdParser,
  page: accessRequestPageParser,
} as const

export const accessReviewSearchParams = {
  'access-view': parseAsStringLiteral(['groups', 'requests'] as const).withDefault('groups'),
  'request-id': accessRequestIdParser,
  'request-search': accessRequestSearchParser,
  'request-page': accessRequestPageParser,
  'request-status': parseAsStringLiteral([
    'pending',
    'fulfilled',
    'declined',
    'cancelled',
    'closed',
    'all',
  ] as const).withDefault('pending'),
} as const

export const accessRequestUrlOptions = { history: 'replace', clearOnDefault: true } as const

export const accessRequestEntrySearchParams = {
  ...accessRequestSearchParams,
  organizationId: accessRequestIdParser,
  view: parseAsStringLiteral(['requests', 'catalog', 'admin'] as const).withDefault('requests'),
  'request-page': accessReviewSearchParams['request-page'],
  'request-search': accessReviewSearchParams['request-search'],
  'request-status': accessReviewSearchParams['request-status'],
} as const
