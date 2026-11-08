import { parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'

const ENABLED_FILTERS = ['all', 'enabled', 'disabled'] as const

/** The document columns a base's list sorts by, as the documents API names them. */
const DOCUMENT_SORT_COLUMNS = [
  'filename',
  'fileSize',
  'tokenCount',
  'chunkCount',
  'uploadedAt',
  'enabled',
] as const

/** Newest uploads first, the documents query's own order, so a clean URL means the default. */
export const documentSortParams = createSortParams(DOCUMENT_SORT_COLUMNS, {
  column: 'uploadedAt',
  direction: 'desc',
})

/**
 * A base's document list: the name search, the enabled filter and the page, grouped so a search or
 * filter change resets the page in the same write. The legacy page uses the same keys, so a link
 * carries across. Tag filter rules stay in memory: they are structured rows, too large for the URL.
 */
export const documentListParsers = {
  q: parseAsString.withDefault(''),
  enabled: parseAsStringLiteral(ENABLED_FILTERS).withDefault('all'),
  page: parseAsInteger.withDefault(1),
} as const

/** `addConnector` opens New connector, its value the source, and survives an OAuth round trip. */
export const addConnectorParser = parseAsString

const CHUNK_SORT_COLUMNS = ['index', 'tokens', 'status'] as const

/** Nullable on purpose: with no sort the chunk query sends no order and the server's applies. */
export const chunkSortParams = createSortParams(CHUNK_SORT_COLUMNS)

/** A document's chunk list: the page, the open chunk, the content search and the enabled filter. */
export const chunkListParsers = {
  page: parseAsInteger.withDefault(1),
  chunk: parseAsString,
  search: parseAsString.withDefault(''),
  enabled: parseAsStringLiteral(ENABLED_FILTERS).withDefault('all'),
} as const

/** Filters, search, sort and paging replace history and drop their defaults from the URL. */
export const knowledgeUrlOptions = {
  history: 'replace',
  clearOnDefault: true,
} as const
