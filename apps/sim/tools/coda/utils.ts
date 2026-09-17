import { omit } from '@sim/utils/object'
import type {
  CodaColumn,
  CodaControl,
  CodaDoc,
  CodaFolder,
  CodaFormula,
  CodaNamedReference,
  CodaPage,
  CodaPermission,
  CodaRow,
  CodaTable,
  CodaTableReference,
} from '@/tools/coda/types'
import type { OutputProperty, ToolConfig, ToolRetryConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const CODA_API_BASE = 'https://coda.io/apis/v1'

type QueryValue = string | number | boolean | null | undefined

/**
 * Builds a Coda API URL from already-guarded path segments and optional query params.
 * Empty query values are omitted so unset optional filters are never sent. A page token
 * already encodes the original query, and Coda rejects any other parameter sent with it
 * (for example `limit` on pages, or `useColumnNames` on rows), so only the token is sent.
 */
export function buildCodaUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${CODA_API_BASE}${path}`)
  const pageToken = query?.pageToken
  const effectiveQuery =
    typeof pageToken === 'string' && pageToken.trim() !== '' ? { pageToken } : (query ?? {})
  for (const [key, value] of Object.entries(effectiveQuery)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * Joins literal path segments with traversal-guarded, percent-encoded identifiers.
 * A string is a literal segment; a `[value, paramName]` tuple is a caller-supplied id.
 */
export function codaPath(...segments: Array<string | [string, string]>): string {
  return segments
    .map((segment) =>
      typeof segment === 'string' ? `/${segment}` : `/${safeUrlPathSegment(segment[0], segment[1])}`
    )
    .join('')
}

/** Guards and encodes a doc-scoped path: `/docs/{docId}` plus any extra segments. */
export function codaDocPath(docId: string, ...segments: Array<string | [string, string]>): string {
  return codaPath('docs', [docId, 'docId'], ...segments)
}

/** Headers for every Coda API request; shared with the credential validator. */
export function codaHeaders(accessToken: string, hasBody = false): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  }
}

/** Parses a JSON value that may arrive as a serialized string from a block input. */
export function parseJsonInput(value: unknown, paramName: string): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(`${paramName} must be valid JSON`)
  }
}

/** Normalizes a list given as an array, JSON array string, or comma-separated string. */
export function parseStringList(value: unknown, paramName: string): string[] {
  if (value === undefined || value === null || value === '') return []
  if (typeof value === 'string' && !value.trim().startsWith('[')) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  const parsed = parseJsonInput(value, paramName)
  if (!Array.isArray(parsed)) {
    throw new Error(`${paramName} must be an array or a comma-separated list`)
  }
  return parsed.map((item) => String(item).trim()).filter(Boolean)
}

/** Joins a list param into Coda's comma-delimited query format, or undefined when empty. */
export function joinListParam(value: unknown, paramName: string): string | undefined {
  const items = parseStringList(value, paramName)
  return items.length > 0 ? items.join(',') : undefined
}

/** Trims an optional string param, returning undefined when blank. */
export function optionalTrimmed(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed || undefined
}

interface CellEdit {
  column: string
  value: unknown
}

function isCellArray(value: unknown): value is CellEdit[] {
  return (
    Array.isArray(value) &&
    value.every(
      (cell) =>
        cell !== null &&
        typeof cell === 'object' &&
        typeof (cell as { column?: unknown }).column === 'string' &&
        'value' in cell
    )
  )
}

/**
 * Converts a row given either as Coda cells (`[{ column, value }]`), a `{ cells: [...] }`
 * object, or a plain `{ columnIdOrName: value }` map into Coda's cell-edit array.
 */
export function toCodaCells(row: unknown, paramName: string): CellEdit[] {
  if (isCellArray(row)) return row
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${paramName} must be an object mapping columns to values`)
  }
  const cells = (row as { cells?: unknown }).cells
  if (cells !== undefined) {
    if (!isCellArray(cells)) {
      throw new Error(`${paramName}.cells must be an array of { column, value } objects`)
    }
    return cells
  }
  return Object.entries(row).map(([column, value]) => ({ column, value }))
}

/** Builds Coda's `PageCreateContent` union from flat tool params, or undefined when absent. */
export function buildPageCreateContent(params: {
  pageType?: string
  contentFormat?: string
  content?: string
  embedUrl?: string
  renderMethod?: string
  sourceDocId?: string
  sourcePageId?: string
  syncMode?: string
  includeSubpages?: boolean
}): Record<string, unknown> | undefined {
  const pageType = params.pageType || 'canvas'
  if (pageType === 'canvas') {
    if (!params.content) return undefined
    return {
      type: 'canvas',
      canvasContent: { format: params.contentFormat || 'markdown', content: params.content },
    }
  }
  if (pageType === 'embed') {
    const url = optionalTrimmed(params.embedUrl)
    if (!url) throw new Error('embedUrl is required when pageType is "embed"')
    return {
      type: 'embed',
      url,
      ...(params.renderMethod ? { renderMethod: params.renderMethod } : {}),
    }
  }
  if (pageType === 'syncPage') {
    const sourceDocId = optionalTrimmed(params.sourceDocId)
    if (!sourceDocId) throw new Error('sourceDocId is required when pageType is "syncPage"')
    if ((params.syncMode || 'page') === 'document') {
      return { type: 'syncPage', mode: 'document', sourceDocId }
    }
    const sourcePageId = optionalTrimmed(params.sourcePageId)
    if (!sourcePageId) throw new Error('sourcePageId is required for a single-page sync page')
    return {
      type: 'syncPage',
      mode: 'page',
      sourceDocId,
      sourcePageId,
      includeSubpages: params.includeSubpages === true,
    }
  }
  throw new Error('pageType must be one of: canvas, embed, syncPage')
}

export const codaAuthParams = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Coda API token resolved from the selected credential',
  },
} satisfies ToolConfig['params']

export const codaOAuth = { required: true, provider: 'coda' } as const

/**
 * Coda rate-limits per user and asks API clients to back off and retry on HTTP 429. Only
 * idempotent methods retry, so a timed-out insert or page creation is never duplicated.
 */
export const CODA_RETRY = {
  enabled: true,
  maxRetries: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  retryIdempotentOnly: true,
} as const satisfies ToolRetryConfig

interface RawReference {
  id?: string
  name?: string
  href?: string
  browserLink?: string
  tableType?: string
}

interface RawPerson {
  name?: string
  email?: string
}

interface RawIcon {
  name?: string
  type?: string
  browserLink?: string
}

function mapIcon(icon: RawIcon | undefined) {
  if (!icon) return null
  return {
    name: icon.name ?? null,
    type: icon.type ?? null,
    browserLink: icon.browserLink ?? null,
  }
}

function mapPerson(person: RawPerson | undefined) {
  if (!person) return null
  return { name: person.name ?? null, email: person.email ?? null }
}

function mapPageRef(ref: RawReference | undefined) {
  if (!ref?.id) return null
  return {
    id: ref.id,
    name: ref.name ?? null,
    href: ref.href ?? null,
    browserLink: ref.browserLink ?? null,
  }
}

function mapTableRef(ref: RawReference | undefined) {
  if (!ref?.id) return null
  return {
    id: ref.id,
    name: ref.name ?? null,
    tableType: ref.tableType ?? null,
    href: ref.href ?? null,
    browserLink: ref.browserLink ?? null,
  }
}

export interface RawCodaWorkspaceReference {
  id?: string
  name?: string
  organizationId?: string
  browserLink?: string
}

export function mapWorkspaceRef(workspace: RawCodaWorkspaceReference | undefined) {
  if (!workspace?.id) return null
  return {
    id: workspace.id,
    name: workspace.name ?? null,
    organizationId: workspace.organizationId ?? null,
    browserLink: workspace.browserLink ?? null,
  }
}

export interface RawCodaDoc {
  id: string
  name: string
  href: string
  browserLink: string
  icon?: RawIcon
  owner?: string
  ownerName?: string
  createdAt?: string
  updatedAt?: string
  workspace?: RawCodaWorkspaceReference
  folder?: RawReference
  sourceDoc?: RawReference
  docSize?: {
    totalRowCount?: number
    tableAndViewCount?: number
    baseTableCount?: number
    pageCount?: number
    overApiSizeLimit?: boolean
  }
  published?: {
    description?: string
    browserLink?: string
    imageLink?: string
    discoverable?: boolean
    earnCredit?: boolean
    mode?: string
    categories?: Array<{ name?: string }>
  }
}

export function mapDoc(doc: RawCodaDoc): CodaDoc {
  return {
    id: doc.id,
    name: doc.name,
    href: doc.href,
    browserLink: doc.browserLink,
    icon: mapIcon(doc.icon),
    owner: doc.owner ?? null,
    ownerName: doc.ownerName ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    workspace: mapWorkspaceRef(doc.workspace),
    folder: doc.folder?.id
      ? {
          id: doc.folder.id,
          name: doc.folder.name ?? null,
          browserLink: doc.folder.browserLink ?? null,
        }
      : null,
    sourceDoc: doc.sourceDoc?.id
      ? {
          id: doc.sourceDoc.id,
          href: doc.sourceDoc.href ?? null,
          browserLink: doc.sourceDoc.browserLink ?? null,
        }
      : null,
    docSize: doc.docSize
      ? {
          totalRowCount: doc.docSize.totalRowCount ?? null,
          tableAndViewCount: doc.docSize.tableAndViewCount ?? null,
          baseTableCount: doc.docSize.baseTableCount ?? null,
          pageCount: doc.docSize.pageCount ?? null,
          overApiSizeLimit: doc.docSize.overApiSizeLimit ?? null,
        }
      : null,
    published: doc.published
      ? {
          description: doc.published.description ?? null,
          browserLink: doc.published.browserLink ?? null,
          imageLink: doc.published.imageLink ?? null,
          discoverable: doc.published.discoverable ?? null,
          earnCredit: doc.published.earnCredit ?? null,
          mode: doc.published.mode ?? null,
          categories: (doc.published.categories ?? [])
            .map((category) => category.name)
            .filter((name): name is string => typeof name === 'string'),
        }
      : null,
  }
}

export interface RawCodaPage {
  id: string
  name: string
  subtitle?: string
  href: string
  browserLink: string
  contentType?: string
  isHidden?: boolean
  isEffectivelyHidden?: boolean
  icon?: RawIcon
  image?: { browserLink?: string; type?: string; width?: number; height?: number }
  parent?: RawReference
  children?: RawReference[]
  authors?: RawPerson[]
  createdAt?: string
  createdBy?: RawPerson
  updatedAt?: string
  updatedBy?: RawPerson
}

export function mapPage(page: RawCodaPage): CodaPage {
  return {
    id: page.id,
    name: page.name,
    subtitle: page.subtitle ?? null,
    href: page.href,
    browserLink: page.browserLink,
    contentType: page.contentType ?? null,
    isHidden: page.isHidden ?? null,
    isEffectivelyHidden: page.isEffectivelyHidden ?? null,
    icon: mapIcon(page.icon),
    image: page.image
      ? {
          browserLink: page.image.browserLink ?? null,
          type: page.image.type ?? null,
          width: page.image.width ?? null,
          height: page.image.height ?? null,
        }
      : null,
    parent: mapPageRef(page.parent),
    children: (page.children ?? []).flatMap((child) => {
      const mapped = mapPageRef(child)
      return mapped ? [mapped] : []
    }),
    authors: (page.authors ?? []).flatMap((author) => {
      const mapped = mapPerson(author)
      return mapped ? [mapped] : []
    }),
    createdAt: page.createdAt ?? null,
    createdBy: mapPerson(page.createdBy),
    updatedAt: page.updatedAt ?? null,
    updatedBy: mapPerson(page.updatedBy),
  }
}

export interface RawCodaTableReference {
  id: string
  name: string
  tableType?: string
  href: string
  browserLink: string
  parent?: RawReference
}

export function mapTableReference(table: RawCodaTableReference): CodaTableReference {
  return {
    id: table.id,
    name: table.name,
    tableType: table.tableType ?? null,
    href: table.href,
    browserLink: table.browserLink,
    parent: mapPageRef(table.parent),
  }
}

export interface RawCodaTable extends RawCodaTableReference {
  parentTable?: RawReference
  displayColumn?: RawReference
  rowCount?: number
  sorts?: Array<{ column?: RawReference; direction?: string }>
  layout?: string
  filter?: {
    valid?: boolean
    isVolatile?: boolean
    hasUserFormula?: boolean
    hasTodayFormula?: boolean
    hasNowFormula?: boolean
  }
  createdAt?: string
  updatedAt?: string
}

export function mapTable(table: RawCodaTable): CodaTable {
  return {
    ...mapTableReference(table),
    parentTable: mapTableRef(table.parentTable),
    displayColumnId: table.displayColumn?.id ?? null,
    rowCount: table.rowCount ?? null,
    sorts: (table.sorts ?? []).map((sort) => ({
      columnId: sort.column?.id ?? null,
      direction: sort.direction ?? null,
    })),
    layout: table.layout ?? null,
    filter: table.filter
      ? {
          valid: table.filter.valid ?? null,
          isVolatile: table.filter.isVolatile ?? null,
          hasUserFormula: table.filter.hasUserFormula ?? null,
          hasTodayFormula: table.filter.hasTodayFormula ?? null,
          hasNowFormula: table.filter.hasNowFormula ?? null,
        }
      : null,
    createdAt: table.createdAt ?? null,
    updatedAt: table.updatedAt ?? null,
  }
}

export interface RawCodaColumn {
  id: string
  name: string
  href: string
  display?: boolean
  calculated?: boolean
  formula?: string
  defaultValue?: string
  format?: Record<string, unknown> & { type?: string; isArray?: boolean }
  parent?: RawReference
}

export function mapColumn(column: RawCodaColumn): CodaColumn {
  return {
    id: column.id,
    name: column.name,
    href: column.href,
    display: column.display ?? null,
    calculated: column.calculated ?? null,
    formula: column.formula ?? null,
    defaultValue: column.defaultValue ?? null,
    format: column.format ?? null,
    parentTable: mapTableRef(column.parent),
  }
}

export interface RawCodaRow {
  id: string
  name: string
  index?: number
  href: string
  browserLink: string
  createdAt?: string
  updatedAt?: string
  values?: Record<string, unknown>
  parent?: RawReference
}

export function mapRow(row: RawCodaRow): CodaRow {
  return {
    id: row.id,
    name: row.name,
    index: row.index ?? null,
    href: row.href,
    browserLink: row.browserLink,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    values: row.values ?? {},
    parentTable: mapTableRef(row.parent),
  }
}

export interface RawCodaNamedReference {
  id: string
  name: string
  href: string
  parent?: RawReference
}

export function mapNamedReference(item: RawCodaNamedReference): CodaNamedReference {
  return {
    id: item.id,
    name: item.name,
    href: item.href,
    parent: mapPageRef(item.parent),
  }
}

export function mapFormula(item: RawCodaNamedReference & { value?: unknown }): CodaFormula {
  return { ...mapNamedReference(item), value: item.value ?? null }
}

export function mapControl(
  item: RawCodaNamedReference & { controlType?: string; value?: unknown }
): CodaControl {
  return {
    ...mapNamedReference(item),
    controlType: item.controlType ?? null,
    value: item.value ?? null,
  }
}

export interface RawCodaFolder {
  id: string
  name?: string
  browserLink?: string
  description?: string
  icon?: RawIcon
  iconColor?: string
  createdAt?: string
  canEdit?: boolean
  workspace?: RawCodaWorkspaceReference
  visibility?: string
}

export function mapFolder(folder: RawCodaFolder): CodaFolder {
  return {
    id: folder.id,
    name: folder.name ?? null,
    browserLink: folder.browserLink ?? null,
    description: folder.description ?? null,
    icon: mapIcon(folder.icon),
    iconColor: folder.iconColor ?? null,
    createdAt: folder.createdAt ?? null,
    canEdit: folder.canEdit ?? null,
    workspace: mapWorkspaceRef(folder.workspace),
  }
}

export interface RawCodaPermission {
  id: string
  access: string
  principal?: {
    type?: string
    email?: string
    groupId?: string
    groupName?: string
    domain?: string
    workspaceId?: string
    internalAccessType?: string
  }
}

export function mapPermission(permission: RawCodaPermission): CodaPermission {
  const principal = permission.principal
  return {
    id: permission.id,
    access: permission.access,
    principal: {
      type: principal?.type ?? null,
      email: principal?.email ?? null,
      groupId: principal?.groupId ?? null,
      groupName: principal?.groupName ?? null,
      domain: principal?.domain ?? null,
      workspaceId: principal?.workspaceId ?? null,
      internalAccessType: principal?.internalAccessType ?? null,
    },
  }
}

export const NEXT_PAGE_TOKEN_OUTPUT = {
  type: 'string',
  description: 'Token to pass as pageToken to fetch the next page of results',
  optional: true,
} as const satisfies OutputProperty

export const REQUEST_ID_OUTPUT = {
  type: 'string',
  description:
    'Coda request ID for the queued change; pass to Get Mutation Status to confirm it was applied',
} as const satisfies OutputProperty

export const ICON_PROPERTIES = {
  name: { type: 'string', description: 'Icon name', optional: true },
  type: { type: 'string', description: 'Icon MIME type', optional: true },
  browserLink: { type: 'string', description: 'Link to the icon image', optional: true },
} as const satisfies Record<string, OutputProperty>

const PERSON_PROPERTIES = {
  name: { type: 'string', description: 'Full name', optional: true },
  email: { type: 'string', description: 'Email address', optional: true },
} as const satisfies Record<string, OutputProperty>

const PAGE_REF_PROPERTIES = {
  id: { type: 'string', description: 'Page ID' },
  name: { type: 'string', description: 'Page name', optional: true },
  href: { type: 'string', description: 'API link to the page', optional: true },
  browserLink: { type: 'string', description: 'Browser link to the page', optional: true },
} as const satisfies Record<string, OutputProperty>

const TABLE_REF_PROPERTIES = {
  id: { type: 'string', description: 'Table ID' },
  name: { type: 'string', description: 'Table name', optional: true },
  tableType: { type: 'string', description: 'Table type (table or view)', optional: true },
  href: { type: 'string', description: 'API link to the table', optional: true },
  browserLink: { type: 'string', description: 'Browser link to the table', optional: true },
} as const satisfies Record<string, OutputProperty>

export const WORKSPACE_REF_PROPERTIES = {
  id: { type: 'string', description: 'Workspace ID' },
  name: { type: 'string', description: 'Workspace name', optional: true },
  organizationId: {
    type: 'string',
    description: 'Organization bound to the workspace',
    optional: true,
  },
  browserLink: { type: 'string', description: 'Browser link to the workspace', optional: true },
} as const satisfies Record<string, OutputProperty>

export const DOC_PROPERTIES = {
  id: { type: 'string', description: 'Doc ID' },
  name: { type: 'string', description: 'Doc name' },
  href: { type: 'string', description: 'API link to the doc' },
  browserLink: { type: 'string', description: 'Browser link to the doc' },
  icon: { type: 'object', description: 'Doc icon', optional: true, properties: ICON_PROPERTIES },
  owner: { type: 'string', description: 'Email address of the doc owner', optional: true },
  ownerName: { type: 'string', description: 'Name of the doc owner', optional: true },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  updatedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
  workspace: {
    type: 'object',
    description: 'Workspace containing the doc',
    optional: true,
    properties: WORKSPACE_REF_PROPERTIES,
  },
  folder: {
    type: 'object',
    description: 'Folder containing the doc',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Folder ID' },
      name: { type: 'string', description: 'Folder name', optional: true },
      browserLink: { type: 'string', description: 'Browser link to the folder', optional: true },
    },
  },
  sourceDoc: {
    type: 'object',
    description: 'Doc this doc was copied from',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Source doc ID' },
      href: { type: 'string', description: 'API link to the source doc', optional: true },
      browserLink: {
        type: 'string',
        description: 'Browser link to the source doc',
        optional: true,
      },
    },
  },
  docSize: {
    type: 'object',
    description: 'Size of the doc',
    optional: true,
    properties: {
      totalRowCount: { type: 'number', description: 'Rows across all tables', optional: true },
      tableAndViewCount: { type: 'number', description: 'Tables and views', optional: true },
      baseTableCount: { type: 'number', description: 'Base tables', optional: true },
      pageCount: { type: 'number', description: 'Pages', optional: true },
      overApiSizeLimit: {
        type: 'boolean',
        description: 'Whether the doc is over the API size limit',
        optional: true,
      },
    },
  },
  published: {
    type: 'object',
    description: 'Publishing settings, when the doc is published',
    optional: true,
    properties: {
      description: { type: 'string', description: 'Published description', optional: true },
      browserLink: { type: 'string', description: 'Published doc link', optional: true },
      imageLink: { type: 'string', description: 'Cover image link', optional: true },
      discoverable: {
        type: 'boolean',
        description: 'Whether the doc is discoverable',
        optional: true,
      },
      earnCredit: {
        type: 'boolean',
        description: 'Whether viewers must sign in so the owner earns credit',
        optional: true,
      },
      mode: { type: 'string', description: 'Interaction mode (view, play, edit)', optional: true },
      categories: {
        type: 'array',
        description: 'Category names',
        items: { type: 'string', description: 'Category name' },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const PAGE_PROPERTIES = {
  id: { type: 'string', description: 'Page ID' },
  name: { type: 'string', description: 'Page name' },
  subtitle: { type: 'string', description: 'Page subtitle', optional: true },
  href: { type: 'string', description: 'API link to the page' },
  browserLink: { type: 'string', description: 'Browser link to the page' },
  contentType: {
    type: 'string',
    description: 'Page type (canvas, embed, or syncPage)',
    optional: true,
  },
  isHidden: { type: 'boolean', description: 'Whether the page is hidden', optional: true },
  isEffectivelyHidden: {
    type: 'boolean',
    description: 'Whether the page or any parent is hidden',
    optional: true,
  },
  icon: { type: 'object', description: 'Page icon', optional: true, properties: ICON_PROPERTIES },
  image: {
    type: 'object',
    description: 'Cover image',
    optional: true,
    properties: {
      browserLink: { type: 'string', description: 'Image link', optional: true },
      type: { type: 'string', description: 'Image MIME type', optional: true },
      width: { type: 'number', description: 'Width in pixels', optional: true },
      height: { type: 'number', description: 'Height in pixels', optional: true },
    },
  },
  parent: {
    type: 'object',
    description: 'Parent page',
    optional: true,
    properties: PAGE_REF_PROPERTIES,
  },
  children: {
    type: 'array',
    description: 'Direct subpages',
    items: { type: 'object', properties: PAGE_REF_PROPERTIES },
  },
  authors: {
    type: 'array',
    description: 'Page authors',
    items: { type: 'object', properties: PERSON_PROPERTIES },
  },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  createdBy: {
    type: 'object',
    description: 'Page creator',
    optional: true,
    properties: PERSON_PROPERTIES,
  },
  updatedAt: { type: 'string', description: 'Last content update timestamp', optional: true },
  updatedBy: {
    type: 'object',
    description: 'Last editor of the page',
    optional: true,
    properties: PERSON_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const TABLE_REFERENCE_PROPERTIES = {
  id: { type: 'string', description: 'Table ID' },
  name: { type: 'string', description: 'Table name' },
  tableType: {
    type: 'string',
    description: 'Table type (table, view, or database)',
    optional: true,
  },
  href: { type: 'string', description: 'API link to the table' },
  browserLink: { type: 'string', description: 'Browser link to the table' },
  parent: {
    type: 'object',
    description: 'Page containing the table',
    optional: true,
    properties: PAGE_REF_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const TABLE_PROPERTIES = {
  ...TABLE_REFERENCE_PROPERTIES,
  parentTable: {
    type: 'object',
    description: 'Base table, when this is a view',
    optional: true,
    properties: TABLE_REF_PROPERTIES,
  },
  displayColumnId: { type: 'string', description: 'Display column ID', optional: true },
  rowCount: { type: 'number', description: 'Total number of rows', optional: true },
  sorts: {
    type: 'array',
    description: 'Sorts applied to the table',
    items: {
      type: 'object',
      properties: {
        columnId: { type: 'string', description: 'Sorted column ID', optional: true },
        direction: { type: 'string', description: 'ascending or descending', optional: true },
      },
    },
  },
  layout: {
    type: 'string',
    description: 'Layout (default, card, calendar, detail, form, ganttChart, etc.)',
    optional: true,
  },
  filter: {
    type: 'object',
    description: 'Details about the table filter formula, if any',
    optional: true,
    properties: {
      valid: {
        type: 'boolean',
        description: 'Whether the filter formula is valid',
        optional: true,
      },
      isVolatile: {
        type: 'boolean',
        description: 'Whether results can differ by context or user',
        optional: true,
      },
      hasUserFormula: { type: 'boolean', description: 'Uses User()', optional: true },
      hasTodayFormula: { type: 'boolean', description: 'Uses Today()', optional: true },
      hasNowFormula: { type: 'boolean', description: 'Uses Now()', optional: true },
    },
  },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  updatedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

export const COLUMN_PROPERTIES = {
  id: { type: 'string', description: 'Column ID' },
  name: { type: 'string', description: 'Column name' },
  href: { type: 'string', description: 'API link to the column' },
  display: { type: 'boolean', description: 'Whether this is the display column', optional: true },
  calculated: {
    type: 'boolean',
    description: 'Whether the column has a formula',
    optional: true,
  },
  formula: { type: 'string', description: 'Column formula', optional: true },
  defaultValue: { type: 'string', description: 'Default value formula', optional: true },
  format: {
    type: 'json',
    description:
      'Column format: always type (text, number, date, select, lookup, button, etc.) and isArray, plus type-specific settings such as precision, currencyCode, dateFormat, options, or the referenced table',
    optional: true,
  },
  parentTable: {
    type: 'object',
    description: 'Table containing the column (returned by Get Column)',
    optional: true,
    properties: TABLE_REF_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const ROW_PROPERTIES = {
  id: { type: 'string', description: 'Row ID' },
  name: { type: 'string', description: 'Row display name' },
  index: { type: 'number', description: 'Index of the row in the table', optional: true },
  href: { type: 'string', description: 'API link to the row' },
  browserLink: { type: 'string', description: 'Browser link to the row' },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  updatedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
  values: {
    type: 'json',
    description: 'Cell values keyed by column ID (or column name when useColumnNames is set)',
  },
  parentTable: {
    type: 'object',
    description: 'Table containing the row (returned by Get Row)',
    optional: true,
    properties: TABLE_REF_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const NAMED_REFERENCE_PROPERTIES = {
  id: { type: 'string', description: 'ID' },
  name: { type: 'string', description: 'Name' },
  href: { type: 'string', description: 'API link' },
  parent: {
    type: 'object',
    description: 'Page containing the item',
    optional: true,
    properties: PAGE_REF_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const FOLDER_PROPERTIES = {
  id: { type: 'string', description: 'Folder ID' },
  name: { type: 'string', description: 'Folder name' },
  browserLink: { type: 'string', description: 'Browser link to the folder' },
  description: { type: 'string', description: 'Folder description', optional: true },
  icon: {
    type: 'object',
    description: 'Folder icon',
    optional: true,
    properties: ICON_PROPERTIES,
  },
  iconColor: { type: 'string', description: 'Folder icon color', optional: true },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  canEdit: {
    type: 'boolean',
    description: 'Whether the folder settings can be edited',
    optional: true,
  },
  workspace: {
    type: 'object',
    description: 'Workspace containing the folder',
    optional: true,
    properties: WORKSPACE_REF_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/** Subfolders you cannot access are returned with only `id` and `visibility`, and never carry an icon. */
export const FOLDER_CHILD_PROPERTIES = {
  ...omit(FOLDER_PROPERTIES, ['icon']),
  name: {
    type: 'string',
    description: 'Folder name (absent for restricted subfolders)',
    optional: true,
  },
  browserLink: {
    type: 'string',
    description: 'Browser link to the folder (absent for restricted subfolders)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PERMISSION_PROPERTIES = {
  id: { type: 'string', description: 'Permission ID' },
  access: { type: 'string', description: 'Access level (readonly, write, comment, none)' },
  principal: {
    type: 'object',
    description: 'Who the permission is granted to',
    properties: {
      type: {
        type: 'string',
        description: 'Principal type (email, group, domain, workspace, anyone, internalAccess)',
        optional: true,
      },
      email: { type: 'string', description: 'Email of an email principal', optional: true },
      groupId: { type: 'string', description: 'Group ID of a group principal', optional: true },
      groupName: { type: 'string', description: 'Name of a group principal', optional: true },
      domain: { type: 'string', description: 'Domain of a domain principal', optional: true },
      workspaceId: {
        type: 'string',
        description: 'Workspace ID of a workspace principal',
        optional: true,
      },
      internalAccessType: {
        type: 'string',
        description: 'Internal access type (e.g., support)',
        optional: true,
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const DOC_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'ID of the doc (e.g., "AbCDeFGH")',
} as const

export const PAGE_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description:
    'ID or name of the page (IDs are recommended, e.g., "canvas-IjkLmnO"; names containing "/" are not supported)',
} as const

export const TABLE_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description:
    'ID or name of the table or view (IDs are recommended, e.g., "grid-pqRst-U"; names containing "/" are not supported)',
} as const

export const ROW_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description:
    'ID or name of the row (IDs are recommended, e.g., "i-tuVwxYz"; names containing "/" are not supported)',
} as const

export const WORKSPACE_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'ID of the workspace (e.g., "ws-1Ab234")',
} as const

export const FOLDER_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'ID of the folder (e.g., "fl-1Ab234")',
} as const

export const LIMIT_PARAM = {
  type: 'number',
  required: false,
  visibility: 'user-or-llm',
  description: 'Maximum number of results to return per page',
} as const

export const PAGE_TOKEN_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description: 'Page token from a previous response to fetch the next page',
} as const

export const SORT_BY_NAME_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description: 'Sort order; "name" sorts alphabetically',
} as const

export const CUSTOM_DOMAIN_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'The custom domain (e.g., "docs.example.com")',
} as const

export const ACL_SETTINGS_OUTPUTS = {
  allowEditorsToChangePermissions: {
    type: 'boolean',
    description: 'Whether editors can change doc permissions (otherwise only the owner can)',
  },
  allowCopying: { type: 'boolean', description: 'Whether viewers can copy the doc' },
  allowViewersToRequestEditing: {
    type: 'boolean',
    description: 'Whether viewers can request edit access',
  },
} as const satisfies Record<string, OutputProperty>
