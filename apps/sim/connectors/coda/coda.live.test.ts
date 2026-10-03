/**
 * Opt-in provider tests. Only documents created here are mutated or deleted.
 * Set CODA_CONNECTOR_LIVE_TOKEN_FILE to a local token file. Optionally set
 * CODA_CONNECTOR_LIVE_FIXTURE_FILE to retain the fixture for UI and access tests.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { codaConnector } from '@/connectors/coda/coda'
import type { ExternalDocument } from '@/connectors/types'
import { buildCodaUrl, codaDocPath, codaHeaders } from '@/tools/coda/utils'

const tokenPath = process.env.CODA_CONNECTOR_LIVE_TOKEN_FILE
const fixturePath = process.env.CODA_CONNECTOR_LIVE_FIXTURE_FILE
const token = tokenPath ? readFileSync(tokenPath, 'utf8').trim() : ''
const resourceSchema = z.object({ id: z.string(), browserLink: z.string() })
const mutationSchema = z.object({ requestId: z.string() })

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  method = 'GET',
  body?: unknown
) {
  const response = await fetchWithRetry(buildCodaUrl(path), {
    method,
    headers: codaHeaders(token, body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`Live Coda ${method} failed (${response.status})`)
  return schema.parse(await response.json())
}

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read()
    if (value !== undefined) return value
    await sleep(1000)
  }
  throw new Error('Coda did not converge within 60 seconds')
}

describe.skipIf(!token)('Coda connector live', { concurrent: false }, () => {
  let docId = ''
  let pageId = ''
  let before: ExternalDocument[] = []
  const marker = `SimConnector-${generateShortId()}`

  async function list() {
    const documents: ExternalDocument[] = []
    let cursor: string | undefined
    for (let count = 0; count < 10; count++) {
      const result = await codaConnector.listDocuments(token, { docIds: [docId] }, cursor)
      documents.push(...result.documents)
      cursor = result.nextCursor
      if (!result.hasMore) return documents
    }
    throw new Error('Unexpected fixture pagination')
  }

  afterAll(async () => {
    if (docId && !fixturePath) {
      await request(codaDocPath(docId), z.object({}), 'DELETE')
    }
  })

  it('creates a disposable page and table, then lists and hydrates both through the connector', async () => {
    const created = await request('/docs', resourceSchema, 'POST', {
      title: `Sim Coda connector verification ${marker}`,
      initialPage: {
        name: 'Connector verification',
        pageContent: {
          type: 'canvas',
          canvasContent: {
            format: 'html',
            content: `<h1>Connector verification</h1><p>${marker} initial content</p><table><tr><th>Name</th><th>Status</th></tr><tr><td>Verification row</td><td>Ready</td></tr></table>`,
          },
        },
      },
    })
    docId = created.id
    if (fixturePath)
      writeFileSync(
        fixturePath,
        JSON.stringify({ docId, browserLink: created.browserLink, marker })
      )
    await waitFor(async () => {
      const result = await codaConnector.validateConfig(token, { docIds: [docId] })
      return result.valid ? true : undefined
    })
    before = await waitFor(async () => {
      const documents = await list()
      if (documents.length < 2) return undefined
      for (const listed of documents) {
        const hydrated = await codaConnector.getDocument(
          token,
          { docIds: [docId] },
          listed.externalId
        )
        if (hydrated?.contentHash !== listed.contentHash) return undefined
      }
      return documents
    })
    expect(before.every((item) => item.contentDeferred && item.content === '')).toBe(true)
    const page = before.find((item) => item.externalId.includes('/pages/'))!
    pageId = page.externalId.split('/')[2]
    const table = before.find((item) => item.externalId.includes('/tables/'))!
    const pageContent = await codaConnector.getDocument(token, { docIds: [docId] }, page.externalId)
    const tableContent = await codaConnector.getDocument(
      token,
      { docIds: [docId] },
      table.externalId
    )
    expect(pageContent?.content).toContain(`${marker} initial content`)
    expect(pageContent?.contentHash).toBe(page.contentHash)
    expect(tableContent?.content).toContain('Name: Verification row')
    expect(tableContent?.content).toContain('Status: Ready')
    expect(tableContent?.contentHash).toBe(table.contentHash)
    if (fixturePath)
      writeFileSync(
        fixturePath,
        JSON.stringify({
          docId,
          pageId,
          tableId: table.externalId.split('/')[2],
          browserLink: created.browserLink,
          marker,
        })
      )
  }, 180_000)

  it('detects page edits and fetches the updated body', async () => {
    const mutation = await request(
      codaDocPath(docId, 'pages', [pageId, 'pageId']),
      mutationSchema,
      'PUT',
      {
        contentUpdate: {
          insertionMode: 'append',
          canvasContent: { format: 'markdown', content: `${marker} updated content` },
        },
      }
    )
    await waitFor(async () => {
      const result = await request(
        `/mutationStatus/${encodeURIComponent(mutation.requestId)}`,
        z.object({ completed: z.boolean() })
      )
      return result.completed ? true : undefined
    })
    const updated = await waitFor(async () => {
      const documents = await list()
      return documents[0].contentHash !== before[0].contentHash ? documents : undefined
    })
    const full = await codaConnector.getDocument(token, { docIds: [docId] }, updated[0].externalId)
    expect(full?.content).toContain(`${marker} updated content`)
    expect(full?.contentHash).toBe(updated[0].contentHash)
  }, 180_000)
  it('detects table row edits through the parent revision and hydrates current rows', async () => {
    const table = (await list()).find((item) => item.externalId.includes('/tables/'))!
    const tableId = table.externalId.split('/')[2]
    const columns = await request(
      codaDocPath(docId, 'tables', [tableId, 'tableId'], 'columns'),
      z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
    )
    const nameColumn = columns.items.find((column) => column.name === 'Name')!
    const mutation = await request(
      codaDocPath(docId, 'tables', [tableId, 'tableId'], 'rows'),
      mutationSchema,
      'POST',
      {
        rows: [{ cells: [{ column: nameColumn.id, value: 'Second verification row' }] }],
      }
    )
    await waitFor(async () => {
      const status = await request(
        `/mutationStatus/${encodeURIComponent(mutation.requestId)}`,
        z.object({ completed: z.boolean() })
      )
      return status.completed ? true : undefined
    })
    const updated = await waitFor(async () => {
      const current = (await list()).find((item) => item.externalId === table.externalId)
      return current?.contentHash !== table.contentHash ? current : undefined
    })
    const full = await codaConnector.getDocument(token, { docIds: [docId] }, updated.externalId)
    expect(full?.content).toContain('Name: Second verification row')
    expect(full?.contentHash).toBe(updated.contentHash)
  }, 180_000)

  it.skipIf(!process.env.CODA_CONNECTOR_LIVE_ORGANIZATION_ID)(
    'reads the fixture through the Enterprise Admin API and directory',
    async () => {
      const config = {
        docIds: [docId],
        organizationId: process.env.CODA_CONNECTOR_LIVE_ORGANIZATION_ID,
      }
      const context = { mirrorsSourceAcls: true, syncRunId: 'live-enterprise-verification' }
      expect(await codaConnector.validateConfig(token, config, context)).toEqual({ valid: true })
      const listed = await codaConnector.listDocuments(token, config, undefined, context)
      expect(listed.documents.length).toBeGreaterThan(0)
      const full = await codaConnector.getDocument(
        token,
        config,
        listed.documents[0].externalId,
        context
      )
      expect(full?.content).toContain(marker)
      const acl = await codaConnector.getDocumentAcls!(token, config, listed.documents, context)
      expect(acl[listed.documents[0].externalId]?.length).toBeGreaterThan(0)
      const directory = await codaConnector.openDirectory!(token, config, context)
      const groups = await directory!.listGroups()
      expect(groups.length).toBeGreaterThan(0)
      for (const group of groups.slice(0, 3)) {
        expect((await directory!.listGroupMembers(group)).complete).toBe(true)
      }
    },
    180_000
  )
})
