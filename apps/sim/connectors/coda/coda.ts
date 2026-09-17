import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import {
  type CodaDoc,
  type CodaResource,
  codaAdminDocSchema,
  codaDocSchema,
  codaEmailSchema,
  codaIdSchema,
  codaJson,
  codaListSchema,
  codaPageSchema,
  codaPages,
  codaPageTokenSchema,
  codaResourceSchema,
  codaTableSchema,
} from '@/connectors/coda/client'
import { codaOrganizationPath, codaSourceConfig } from '@/connectors/coda/config'
import { codaConnectorMeta } from '@/connectors/coda/meta'
import {
  openCodaDirectory,
  resolveCodaAcls,
  validateCodaAdminAccess,
  validateCodaDocPermissions,
} from '@/connectors/coda/permissions'
import { codaDocumentPath, readCodaDoc } from '@/connectors/coda/source'
import { ConnectorSourceError } from '@/connectors/source-error'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { CONNECTOR_TEXT_DOCUMENT_MAX_BYTES, parseTagDate } from '@/connectors/utils'

const DOC_PAGE_SIZE = 10
const MAX_CURSOR_LENGTH = 512 * 1024
const cursorSchema = z.object({
  version: z.literal(1),
  docIndex: z.number().int().min(0).max(100),
  docToken: codaPageTokenSchema.optional(),
  nextDocToken: codaPageTokenSchema.optional(),
  doc: codaDocSchema.optional(),
  pendingDocs: z
    .array(codaDocSchema)
    .max(DOC_PAGE_SIZE - 1)
    .optional(),
  phase: z.enum(['pages', 'tables']),
  pageToken: codaPageTokenSchema.optional(),
  organizationId: codaIdSchema.optional(),
})
type CodaCursor = z.infer<typeof cursorSchema>
type ResourceKind = 'pages' | 'tables'
const listedDocSchema = z.object({
  doc: codaDocSchema,
  organizationId: codaIdSchema.optional(),
})

function encodeCursor(cursor: CodaCursor): string {
  const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url')
  if (encoded.length > MAX_CURSOR_LENGTH) throw new Error('Coda cursor exceeded its size limit')
  return encoded
}

function decodeCursor(value?: string): CodaCursor {
  if (!value) return { version: 1, docIndex: 0, phase: 'pages' }
  if (value.length > MAX_CURSOR_LENGTH) throw new Error('Invalid Coda cursor')
  return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
}

/** The shared generation ID refreshes exports whose optional Admin revision is absent. */
function listingToken(context?: Record<string, unknown>): string {
  if (typeof context?.syncRunId === 'string') return context.syncRunId
  if (typeof context?._codaListingToken === 'string') return context._codaListingToken
  const token = generateId()
  if (context) context._codaListingToken = token
  return token
}

/** Doc revisions also invalidate tables when row edits do not update table metadata. */
function toStub(
  doc: CodaDoc,
  resource: CodaResource,
  kind: ResourceKind,
  context?: Record<string, unknown>
): ExternalDocument {
  return {
    externalId: `${doc.id}/${kind}/${resource.id}`,
    title: `${doc.name} / ${resource.name}`,
    content: '',
    contentDeferred: true,
    estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
    mimeType: 'text/plain',
    sourceUrl: resource.browserLink,
    contentHash: `coda:${JSON.stringify([doc.id, kind, resource.id, doc.updatedAt ?? `run:${listingToken(context)}`, doc.name, resource.name])}`,
    metadata: {
      docId: doc.id,
      document: doc.name,
      resourceType: kind,
      lastModified: doc.updatedAt,
    },
  }
}

function parseExternalId(externalId: string): {
  docId: string
  kind: ResourceKind
  resourceId: string
} {
  const [docId, kind, resourceId, extra] = externalId.split('/')
  if (extra !== undefined || (kind !== 'pages' && kind !== 'tables')) {
    throw new Error('Invalid Coda document ID')
  }
  return { docId: codaIdSchema.parse(docId), kind, resourceId: codaIdSchema.parse(resourceId) }
}

function nextDocument(state: CodaCursor, docIds: string[]): CodaCursor | undefined {
  if (docIds.length > 0) {
    return state.docIndex + 1 < docIds.length
      ? { version: 1, docIndex: state.docIndex + 1, phase: 'pages' }
      : undefined
  }
  if (state.pendingDocs?.length) {
    return {
      version: 1,
      docIndex: 0,
      phase: 'pages',
      doc: state.pendingDocs[0],
      pendingDocs: state.pendingDocs.slice(1),
      nextDocToken: state.nextDocToken,
    }
  }
  return state.nextDocToken
    ? { version: 1, docIndex: 0, phase: 'pages', docToken: state.nextDocToken }
    : undefined
}

async function listDocuments(
  token: string,
  sourceConfig: Record<string, unknown>,
  cursor?: string,
  context?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const { docIds, organizationId } = codaSourceConfig(sourceConfig, context)
  const admin = Boolean(organizationId)
  const root = organizationId ? codaOrganizationPath(organizationId, 'docs') : '/docs'
  const state = decodeCursor(cursor)
  if (cursor && state.organizationId !== organizationId)
    throw new Error('Coda cursor belongs to a different source')
  state.organizationId = organizationId
  if (admin && state.phase === 'tables') throw new Error('Invalid Coda organization cursor')
  if (state.doc && docIds.length && state.doc.id !== docIds[state.docIndex]) {
    throw new Error('Coda cursor belongs to a different document scope')
  }
  if (!state.doc) {
    if (docIds.length) {
      const docId = docIds[state.docIndex]
      if (!docId) throw new Error('Invalid Coda document cursor')
      try {
        state.doc = await readCodaDoc(token, docId, organizationId)
      } catch (error) {
        if (!(error instanceof ConnectorSourceError && [404, 410].includes(error.status)))
          throw error
        const next = nextDocument(state, docIds)
        return {
          documents: [],
          hasMore: Boolean(next),
          nextCursor: next && encodeCursor({ ...next, organizationId }),
          reconciliationSafe: true,
        }
      }
    } else {
      const listed = await codaJson(
        token,
        root,
        codaListSchema(admin ? codaAdminDocSchema : codaDocSchema),
        {
          limit: DOC_PAGE_SIZE,
          pageToken: state.docToken,
          ...(admin ? { docAvailabilityState: 'online', fetchPermissionsMode: 'none' } : {}),
        },
        false,
        admin
      )
      if (listed.items.length > DOC_PAGE_SIZE)
        throw new Error('Coda ignored the document page size')
      if (listed.nextPageToken && listed.nextPageToken === state.docToken) {
        throw new Error('Coda repeated a document pagination token')
      }
      state.doc = listed.items[0]
      state.pendingDocs = listed.items.slice(1)
      state.nextDocToken = listed.nextPageToken
      if (!state.doc) {
        const next = nextDocument(state, docIds)
        return {
          documents: [],
          hasMore: Boolean(next),
          nextCursor: next && encodeCursor({ ...next, organizationId }),
          reconciliationSafe: false,
        }
      }
    }
  }

  const currentCursor = encodeCursor(state)
  if (state.doc.isDeleted || state.doc.keyAccessRevoked) {
    const next = nextDocument(state, docIds)
    return {
      documents: [],
      hasMore: Boolean(next),
      nextCursor: next && encodeCursor({ ...next, organizationId }),
      reconciliationSafe: docIds.length > 0,
    }
  }
  if (context) context._codaListedDoc = { doc: state.doc, organizationId }
  const path = `${codaDocumentPath(state.doc, organizationId)}/${state.phase}`
  const schema = admin
    ? codaResourceSchema
    : state.phase === 'pages'
      ? codaPageSchema
      : codaTableSchema
  const listed = await codaJson(
    token,
    path,
    codaListSchema(schema),
    {
      limit: 100,
      pageToken: state.pageToken,
    },
    false,
    admin
  )
  if (listed.nextPageToken && listed.nextPageToken === state.pageToken) {
    throw new Error('Coda repeated a resource pagination token')
  }
  const doc = state.doc
  const documents = listed.items
    .filter(
      (item) =>
        admin ||
        ('contentType' in item
          ? item.contentType === 'canvas' &&
            'isHidden' in item &&
            item.isHidden === false &&
            'isEffectivelyHidden' in item &&
            item.isEffectivelyHidden === false
          : 'tableType' in item && item.tableType === 'table')
    )
    .map((item) => toStub(doc, item, state.phase, context))
  const next: CodaCursor | undefined = listed.nextPageToken
    ? { ...state, pageToken: listed.nextPageToken }
    : state.phase === 'pages' && !admin
      ? { ...state, phase: 'tables', pageToken: undefined }
      : nextDocument(state, docIds)
  return {
    documents,
    currentCursor,
    hasMore: Boolean(next),
    nextCursor: next && encodeCursor({ ...next, organizationId }),
    /** Coda sorts discovered docs by user activity and does not promise a snapshot. */
    reconciliationSafe: docIds.length > 0,
  }
}

const lineSchema = z.object({
  type: z.literal('line'),
  itemContent: z.object({ format: z.literal('plainText'), content: z.string() }).optional(),
})
const columnSchema = z.object({ id: codaIdSchema, name: z.string().max(4096) })
const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const rowSchema = z.object({
  name: z.string(),
  values: z.record(z.string(), z.union([cellSchema, z.array(cellSchema)])),
})

/** Throws instead of indexing a truncated page or table as though it were complete. */
class CodaText {
  private readonly parts: string[] = []
  private bytes = 0

  append(text: string): void {
    this.bytes += Buffer.byteLength(text, 'utf8') + 2
    if (this.bytes > CONNECTOR_TEXT_DOCUMENT_MAX_BYTES) {
      throw new Error('Coda content exceeded the 12MB limit')
    }
    this.parts.push(text)
  }

  toString(): string {
    return this.parts.join('\n\n')
  }
}

async function getDocument(
  token: string,
  sourceConfig: Record<string, unknown>,
  externalId: string,
  context?: Record<string, unknown>
) {
  const { docIds, organizationId } = codaSourceConfig(sourceConfig, context)
  const { docId, kind, resourceId } = parseExternalId(externalId)
  if (docIds.length > 0 && !docIds.includes(docId)) return null
  try {
    const cached = listedDocSchema.safeParse(context?._codaListedDoc)
    const doc =
      cached.success &&
      cached.data.organizationId === organizationId &&
      cached.data.doc.id === docId
        ? cached.data.doc
        : await readCodaDoc(token, docId, organizationId)
    const path = `${codaDocumentPath(doc, organizationId)}/${kind}/${encodeURIComponent(resourceId)}`
    if (doc.isDeleted || doc.keyAccessRevoked) return null
    if (organizationId) {
      if (kind !== 'pages') return null
      const page = await codaJson(
        token,
        path,
        codaResourceSchema.extend({
          pageContent: z.object({ content: z.string() }),
        }),
        { outputFormat: 'LossyPlainText' },
        false,
        true
      )
      if (page.id !== resourceId) throw new Error('Coda returned a different page')
      const text = new CodaText()
      text.append(`${doc.name}\n${page.name}`)
      text.append(page.pageContent.content)
      return {
        ...toStub(doc, page, kind, context),
        content: text.toString(),
        contentDeferred: false,
      }
    }
    const resource = await codaJson(
      token,
      path,
      kind === 'pages' ? codaPageSchema : codaTableSchema
    )
    if (resource.id !== resourceId) throw new Error('Coda returned a different resource')
    if ('contentType' in resource) {
      if (resource.contentType !== 'canvas' || resource.isHidden || resource.isEffectivelyHidden) {
        return null
      }
    } else if (resource.tableType !== 'table') return null
    const text = new CodaText()
    text.append(`${doc.name}\n${resource.name}`)
    if (kind === 'pages') {
      for await (const items of codaPages(token, `${path}/content`, lineSchema, {
        contentFormat: 'plainText',
      })) {
        for (const item of items) if (item.itemContent) text.append(item.itemContent.content)
      }
    } else {
      const columns = new Map<string, string>()
      for await (const items of codaPages(token, `${path}/columns`, columnSchema)) {
        for (const column of items) {
          if (columns.size >= 1000) throw new Error('Coda table exceeded the 1000-column limit')
          columns.set(column.id, column.name)
        }
      }
      for await (const items of codaPages(token, `${path}/rows`, rowSchema, {
        valueFormat: 'simple',
      })) {
        for (const row of items) {
          text.append(
            [
              row.name,
              ...Object.entries(row.values).map(([id, value]) => {
                const rendered = Array.isArray(value) ? value.join(', ') : String(value ?? '')
                return `${columns.get(id) ?? id}: ${rendered}`
              }),
            ].join('\n')
          )
        }
      }
    }
    return {
      ...toStub(doc, resource, kind, context),
      content: text.toString(),
      contentDeferred: false,
    }
  } catch (error) {
    if (error instanceof ConnectorSourceError && (error.status === 404 || error.status === 410)) {
      return null
    }
    throw error
  }
}

export const codaConnector: ConnectorConfig = {
  ...codaConnectorMeta,
  contentConcurrency: 2,
  listDocuments,
  getDocument,
  getDocumentAcls: resolveCodaAcls,
  openDirectory: async (token, config, context) => {
    const { organizationId } = codaSourceConfig(config, context)
    return organizationId ? openCodaDirectory(token, organizationId) : null
  },
  validateConfig: async (token, sourceConfig, context) => {
    try {
      const { docIds, organizationId } = codaSourceConfig(sourceConfig, context)
      await codaJson(token, '/whoami', z.object({ loginId: codaEmailSchema }), undefined, true)
      if (organizationId) await validateCodaAdminAccess(token, organizationId)
      const root = organizationId ? codaOrganizationPath(organizationId, 'docs') : '/docs'
      let probeDoc: CodaDoc | undefined
      const firstDocId = docIds[0]
      if (firstDocId) {
        probeDoc = await readCodaDoc(token, firstDocId, organizationId, true)
      } else {
        const docs = await codaJson(
          token,
          root,
          codaListSchema(organizationId ? codaAdminDocSchema : codaDocSchema),
          {
            limit: 1,
            ...(organizationId
              ? { fetchPermissionsMode: 'none', docAvailabilityState: 'online' }
              : {}),
          },
          true,
          Boolean(organizationId)
        )
        probeDoc = docs.items[0]
      }
      if (context?.mirrorsSourceAcls === true && probeDoc)
        await validateCodaDocPermissions(token, probeDoc, organizationId)
      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Unable to connect to Coda') }
    }
  },
  isCredentialInvalidError: (error) =>
    error instanceof ConnectorSourceError && error.status === 401,
  mapTags: (metadata) => ({
    document: metadata.document,
    resourceType: metadata.resourceType,
    lastModified: parseTagDate(metadata.lastModified),
  }),
}
