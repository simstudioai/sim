/**
 * Live end-to-end verification of the Coda integration against a real Coda account.
 *
 * Skipped unless `CODA_LIVE=1` and `CODA_API_TOKEN` are set, so it is inert in CI. Every
 * operation runs the way a workflow run does: block field values go through the block's
 * `tools.config.params`, then the real `executeTool` pipeline (request building, fetch,
 * error extraction, `transformResponse`). Each output is checked against the tool's
 * declared output schema. Selector attachments and the credential validator also run live.
 *
 * The suite only mutates resources it creates (a folder, a doc, and a copy of Coda's public
 * API guide doc, whose button it pushes) and deletes them at the end. Sharing with an email
 * address runs only when `CODA_LIVE_SHARE_EMAIL` is set; notifications are suppressed.
 *
 *   CODA_LIVE=1 CODA_API_TOKEN=... ../../node_modules/.bin/vitest run tools/coda/coda.live.test.ts
 *
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/tools/registry')

import { validateCodaServiceAccount } from '@/lib/credentials/token-service-accounts/validators/coda'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { codaSelectorAttachments } from '@/lib/selectors/server/providers/coda'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import type { SelectorContext, SelectorRequest } from '@/lib/selectors/types'
import { CodaBlock } from '@/blocks/blocks/coda'
import { executeTool } from '@/tools'
import { tools as toolRegistry } from '@/tools/registry'
import type { OutputProperty } from '@/tools/types'

const LIVE = process.env.CODA_LIVE === '1' && Boolean(process.env.CODA_API_TOKEN)
const token = process.env.CODA_API_TOKEN ?? ''
const shareEmail = process.env.CODA_LIVE_SHARE_EMAIL
const TIMEOUT = 300_000

interface RunResult {
  success: boolean
  output: Record<string, any>
  error?: string
}

function log(label: string, value: unknown) {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value)
  process.stdout.write(`  [coda-live] ${label}: ${rendered?.slice(0, 1200)}\n`)
}

/** Recursively checks a tool output against its declared output schema. */
function schemaViolations(
  value: unknown,
  schema: OutputProperty,
  path: string,
  violations: string[]
): void {
  if (value === null) {
    if (!schema.nullable) violations.push(`${path}: null but not declared nullable`)
    return
  }
  if (value === undefined) {
    if (!schema.optional) violations.push(`${path}: missing but not declared optional`)
    return
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string')
        violations.push(`${path}: expected string, got ${typeof value}`)
      return
    case 'number':
      if (typeof value !== 'number')
        violations.push(`${path}: expected number, got ${typeof value}`)
      return
    case 'boolean':
      if (typeof value !== 'boolean')
        violations.push(`${path}: expected boolean, got ${typeof value}`)
      return
    case 'array': {
      if (!Array.isArray(value)) {
        violations.push(`${path}: expected array`)
        return
      }
      if (schema.items) {
        value.forEach((item, index) =>
          schemaViolations(item, schema.items as OutputProperty, `${path}[${index}]`, violations)
        )
      }
      return
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        violations.push(`${path}: expected object`)
        return
      }
      if (schema.properties) {
        objectViolations(value as Record<string, unknown>, schema.properties, path, violations)
      }
      return
    }
    default:
      return
  }
}

function objectViolations(
  value: Record<string, unknown>,
  properties: Record<string, OutputProperty>,
  path: string,
  violations: string[]
) {
  for (const [key, property] of Object.entries(properties)) {
    schemaViolations(value[key], property, `${path}.${key}`, violations)
  }
  for (const key of Object.keys(value)) {
    if (!(key in properties)) violations.push(`${path}.${key}: not declared in outputs`)
  }
}

/**
 * Runs one block operation exactly like the generic block handler: the serialized field
 * values are merged with `tools.config.params`, and the selected tool runs through
 * `executeTool` with the credential's resolved access token.
 */
async function run(values: Record<string, unknown>): Promise<RunResult> {
  const config = CodaBlock.tools.config!
  const toolId = config.tool!(values) as string
  const mapped = config.params ? config.params(values) : {}
  const result = (await executeTool(toolId, {
    ...values,
    ...mapped,
    accessToken: token,
  })) as RunResult
  if (result.success) {
    const tool = toolRegistry[toolId]
    const violations: string[] = []
    objectViolations(result.output, tool.outputs ?? {}, toolId, violations)
    expect(violations, `${toolId} output schema`).toEqual([])
  }
  log(`${values.operation}`, result.success ? result.output : `ERROR ${result.error}`)
  return result
}

async function runOk(values: Record<string, unknown>): Promise<Record<string, any>> {
  const result = await run(values)
  expect(result.error, `${values.operation} failed`).toBeUndefined()
  expect(result.success).toBe(true)
  return result.output
}

async function waitForMutation(requestId: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await runOk({ operation: 'get_mutation_status', mutationRequestId: requestId })
    if (status.completed) return status
    await sleep(2_000)
  }
  throw new Error(`mutation ${requestId} did not complete`)
}

/** New docs return 409 until Coda finishes provisioning them for the API. */
async function waitForDocReady(docId: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await executeTool('coda_list_pages', { accessToken: token, docId })
    if (result.success) return
    await sleep(2_000)
  }
  throw new Error(`doc ${docId} never became accessible`)
}

async function waitFor<T>(label: string, probe: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 45; attempt++) {
    const value = await probe()
    if (value !== undefined) return value
    await sleep(2_000)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function selectorArgs(
  selectorKey: ExecuteServerSelectorArgs['selectorKey'],
  request: SelectorRequest,
  context: SelectorContext = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'live-credential', ...context },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-live' },
    workspaceId: 'workspace-live',
    principal: { kind: 'session', userId: 'user-live', sessionId: 'session-live' },
    requesterUserId: 'user-live',
    credential: { suppliedId: 'live-credential', fixedToken: token, providerId: 'coda' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

const state: {
  workspaceId?: string
  loginId?: string
  myDocsFolderId?: string
  folderId?: string
  docId?: string
  docBrowserLink?: string
  homePageId?: string
  subPageId?: string
  embedPageId?: string
  syncPageId?: string
  tableId?: string
  nameColumnId?: string
  statusColumnId?: string
  rowIds: string[]
  permissionId?: string
  published?: boolean
  copyDocId?: string
} = { rowIds: [] }

describe.skipIf(!LIVE).sequential('coda live end-to-end', () => {
  beforeAll(() => {
    vi.unstubAllGlobals()
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false)
  })

  afterAll(async () => {
    if (!LIVE) return
    if (state.docId)
      await executeTool('coda_delete_doc', { accessToken: token, docId: state.docId })
    if (state.copyDocId) {
      await executeTool('coda_delete_doc', { accessToken: token, docId: state.copyDocId })
    }
    if (state.folderId) {
      await sleep(3_000)
      await executeTool('coda_delete_folder', { accessToken: token, folderId: state.folderId })
    }
  }, TIMEOUT)

  it(
    'validates the token like the credential connect flow',
    async () => {
      const result = await validateCodaServiceAccount({ apiToken: token })
      log('validator', result)
      expect(result.principal).toMatchObject({ kind: 'user' })
      await expect(
        validateCodaServiceAccount({ apiToken: 'not-a-real-token' })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
    },
    TIMEOUT
  )

  it(
    'reads the account, categories, and folders',
    async () => {
      const me = await runOk({ operation: 'whoami' })
      state.workspaceId = me.workspace.id
      state.loginId = me.loginId
      const categories = await runOk({ operation: 'list_categories' })
      expect(categories.categories.length).toBeGreaterThan(0)
      const folders = await runOk({ operation: 'list_folders', limit: '50' })
      state.myDocsFolderId = folders.folders[0]?.id
      expect(state.myDocsFolderId).toBeTruthy()
      await runOk({
        operation: 'list_folders',
        workspaceFilter: state.workspaceId,
        starred: 'false',
      })
      await runOk({ operation: 'get_folder', folderId: state.myDocsFolderId })
      await runOk({ operation: 'get_analytics_last_updated' })
    },
    TIMEOUT
  )

  it(
    'creates, updates, reads, and lists a folder',
    async () => {
      const created = await runOk({
        operation: 'create_folder',
        workspaceId: state.workspaceId,
        folderName: ' Sim Coda E2E ',
        folderDescription: 'Created by the Sim live test',
      })
      state.folderId = created.folder.id
      expect(created.folder.name).toBe('Sim Coda E2E')
      const updated = await runOk({
        operation: 'update_folder',
        folderId: state.folderId,
        folderName: 'Sim Coda E2E (renamed)',
        folderDescription: '',
      })
      expect(updated.folder.id).toBe(state.folderId)
      const renamed = await waitFor('folder rename', async () => {
        const read = await runOk({ operation: 'get_folder', folderId: state.folderId })
        return read.folder.name === 'Sim Coda E2E (renamed)' ? read.folder : undefined
      })
      expect(renamed.description).toBe('Created by the Sim live test')
      await runOk({
        operation: 'list_folder_children',
        folderId: state.myDocsFolderId,
        limit: '10',
      })
    },
    TIMEOUT
  )

  it(
    'creates a doc with an initial HTML page and table, then reads and updates it',
    async () => {
      const created = await runOk({
        operation: 'create_doc',
        docTitle: 'Sim Coda E2E Doc',
        folderId: state.folderId,
        timezone: 'America/Los_Angeles',
        pageName: 'Home',
        pageSubtitle: 'Live test home',
        iconName: 'rocket',
        pageType: 'canvas',
        contentFormat: 'html',
        pageContent:
          '<h1>Tasks</h1><p>Intro paragraph</p><table><tr><th>Name</th><th>Status</th></tr><tr><td>Seed</td><td>Open</td></tr></table>',
      })
      state.docId = created.doc.id
      state.docBrowserLink = created.doc.browserLink
      expect(created.doc.folder?.id).toBe(state.folderId)
      await waitForDocReady(state.docId!)

      const doc = await runOk({ operation: 'get_doc', docId: state.docId })
      expect(doc.doc.name).toBe('Sim Coda E2E Doc')
      await runOk({ operation: 'update_doc', docId: state.docId, docTitle: 'Sim Coda E2E Doc v2' })
      await waitFor('doc rename', async () => {
        const again = await runOk({ operation: 'get_doc', docId: state.docId })
        return again.doc.name === 'Sim Coda E2E Doc v2' ? true : undefined
      })
      await runOk({ operation: 'update_doc', docId: state.docId, iconName: 'rocket' })
      const listed = await runOk({
        operation: 'list_docs',
        docSearch: 'Sim Coda E2E',
        isOwner: true,
        folderId: state.folderId,
        workspaceFilter: state.workspaceId,
        starred: 'any',
        limit: '5',
      })
      expect(listed.docs.map((d: { id: string }) => d.id)).toContain(state.docId)
      await runOk({ operation: 'list_docs', sourceDoc: state.docId, inGallery: false })
    },
    TIMEOUT
  )

  it(
    'lists docs, pages, tables, and folders through the dropdown selectors',
    async () => {
      const docs = await codaSelectorAttachments['coda.docs'].execute(
        selectorArgs('coda.docs', { kind: 'list', search: 'Sim Coda E2E' })
      )
      log('selector coda.docs', docs)
      expect(docs.kind === 'list' && docs.items.some((item) => item.id === state.docId)).toBe(true)
      const docDetail = await codaSelectorAttachments['coda.docs'].execute(
        selectorArgs('coda.docs', { kind: 'detail', id: state.docId! })
      )
      expect(docDetail).toMatchObject({ kind: 'detail', item: { id: state.docId } })

      const pages = await codaSelectorAttachments['coda.pages'].execute(
        selectorArgs('coda.pages', { kind: 'list' }, { docId: state.docId })
      )
      log('selector coda.pages', pages)
      expect(pages.kind === 'list' && pages.items.length).toBeGreaterThan(0)
      if (pages.kind === 'list') state.homePageId = pages.items[0].id

      const tables = await codaSelectorAttachments['coda.tables'].execute(
        selectorArgs('coda.tables', { kind: 'list' }, { docId: state.docId })
      )
      log('selector coda.tables', tables)
      if (tables.kind === 'list') state.tableId = tables.items[0]?.id
      expect(state.tableId).toBeTruthy()

      const folders = await codaSelectorAttachments['coda.folders'].execute(
        selectorArgs('coda.folders', { kind: 'list' })
      )
      expect(folders.kind === 'list' && folders.items.some((f) => f.id === state.folderId)).toBe(
        true
      )
      await expect(
        codaSelectorAttachments['coda.pages'].execute(
          selectorArgs(
            'coda.pages',
            { kind: 'detail', id: 'canvas-doesnotexist' },
            {
              docId: state.docId,
            }
          )
        )
      ).resolves.toEqual({ kind: 'detail', item: null })
    },
    TIMEOUT
  )

  it(
    'creates, updates, reads, exports, and deletes pages and content',
    async () => {
      const home = await runOk({
        operation: 'get_page',
        docId: state.docId,
        pageId: state.homePageId,
      })
      expect(home.page.subtitle).toBe('Live test home')

      const sub = await runOk({
        operation: 'create_page',
        docId: state.docId,
        pageName: 'Child page',
        parentPageId: state.homePageId,
        pageType: 'canvas',
        contentFormat: 'markdown',
        pageContent: '# Child\n\n- one\n- two',
        pageSubtitle: 'child subtitle',
        iconName: 'star',
      })
      state.subPageId = sub.pageId
      await waitForMutation(sub.requestId)

      const embed = await runOk({
        operation: 'create_page',
        docId: state.docId,
        pageName: 'Embed page',
        pageType: 'embed',
        embedUrl: 'https://example.com',
        renderMethod: 'standard',
      })
      state.embedPageId = embed.pageId
      await waitForMutation(embed.requestId)

      const sync = await run({
        operation: 'create_page',
        docId: state.docId,
        pageName: 'Sync page',
        pageType: 'syncPage',
        syncSourceDocId: state.docId,
        syncMode: 'page',
        syncSourcePageId: state.subPageId,
        includeSubpages: false,
      })
      if (sync.success) {
        state.syncPageId = sync.output.pageId
        await waitForMutation(sync.output.requestId)
      }

      const pages = await runOk({ operation: 'list_pages', docId: state.docId, limit: '50' })
      expect(pages.pages.map((p: { id: string }) => p.id)).toContain(state.subPageId)
      const child = await runOk({
        operation: 'get_page',
        docId: state.docId,
        pageId: state.subPageId,
      })
      expect(child.page.parent?.id).toBe(state.homePageId)

      const updated = await runOk({
        operation: 'update_page',
        docId: state.docId,
        pageId: state.subPageId,
        pageName: 'Child page renamed',
        pageSubtitle: 'new subtitle',
        pageVisibility: 'unchanged',
        insertionMode: 'append',
        contentFormat: 'markdown',
        pageContent: 'Appended paragraph',
      })
      await waitForMutation(updated.requestId)
      const renamedPage = await runOk({
        operation: 'get_page',
        docId: state.docId,
        pageId: state.subPageId,
      })
      expect(renamedPage.page.name).toBe('Child page renamed')
      expect(renamedPage.page.subtitle).toBe('new subtitle')

      const hide = await run({
        operation: 'update_page',
        docId: state.docId,
        pageId: state.subPageId,
        pageVisibility: 'hidden',
      })
      if (hide.success) {
        await waitForMutation(hide.output.requestId)
      } else {
        expect(hide.error).toMatch(/plan/i)
      }

      const content = await runOk({
        operation: 'get_page_content',
        docId: state.docId,
        pageId: state.subPageId,
        limit: '100',
      })
      expect(
        content.items.some((i: { content: string }) => i.content === 'Appended paragraph')
      ).toBe(true)
      const target = content.items.find(
        (i: { content: string }) => i.content === 'Appended paragraph'
      )

      const replaced = await runOk({
        operation: 'update_page',
        docId: state.docId,
        pageId: state.subPageId,
        insertionMode: 'replace',
        elementId: target.id,
        contentFormat: 'html',
        pageContent: '<p>Replaced paragraph</p>',
      })
      await waitForMutation(replaced.requestId)
      const afterReplace = await runOk({
        operation: 'get_page_content',
        docId: state.docId,
        pageId: state.subPageId,
      })
      const replacedItem = afterReplace.items.find(
        (i: { content: string }) => i.content === 'Replaced paragraph'
      )
      expect(replacedItem).toBeTruthy()

      const guard = await run({
        operation: 'delete_page_content',
        docId: state.docId,
        pageId: state.subPageId,
      })
      expect(guard.success).toBe(false)
      expect(guard.error).toContain('deleteAll')

      const deletedOne = await runOk({
        operation: 'delete_page_content',
        docId: state.docId,
        pageId: state.subPageId,
        elementIds: replacedItem.id,
      })
      await waitForMutation(deletedOne.requestId)

      const exported = await runOk({
        operation: 'export_page',
        docId: state.docId,
        pageId: state.homePageId,
        outputFormat: 'markdown',
      })
      const finished = await waitFor('export', async () => {
        const status = await runOk({
          operation: 'get_page_export_status',
          docId: state.docId,
          pageId: state.homePageId,
          exportId: exported.exportId,
        })
        return status.status === 'complete' || status.status === 'failed' ? status : undefined
      })
      expect(finished.status).toBe('complete')
      const markdown = await (await fetch(finished.downloadLink)).text()
      log('export markdown', markdown)
      expect(markdown).toContain('Tasks')

      const clearAll = await runOk({
        operation: 'delete_page_content',
        docId: state.docId,
        pageId: state.subPageId,
        deleteAllContent: true,
      })
      await waitForMutation(clearAll.requestId)

      const removed = await runOk({
        operation: 'delete_page',
        docId: state.docId,
        pageId: state.embedPageId,
      })
      await waitForMutation(removed.requestId)
    },
    TIMEOUT
  )

  it(
    'reads the table schema and inserts, upserts, updates, and deletes rows',
    async () => {
      await runOk({
        operation: 'list_tables',
        docId: state.docId,
        tableTypes: 'table',
        listSortBy: 'name',
      })
      const allTables = await runOk({ operation: 'list_tables', docId: state.docId })
      expect(allTables.tables.map((t: { id: string }) => t.id)).toContain(state.tableId)
      await runOk({
        operation: 'get_table',
        docId: state.docId,
        tableId: state.tableId,
        useUpdatedTableLayouts: true,
      })
      const columns = await runOk({
        operation: 'list_columns',
        docId: state.docId,
        tableId: state.tableId,
        visibleOnly: true,
      })
      state.nameColumnId = columns.columns.find((c: { name: string }) => c.name === 'Name')?.id
      state.statusColumnId = columns.columns.find((c: { name: string }) => c.name === 'Status')?.id
      expect(state.nameColumnId && state.statusColumnId).toBeTruthy()
      await runOk({
        operation: 'get_column',
        docId: state.docId,
        tableId: state.tableId,
        columnId: state.nameColumnId,
      })

      const columnOptions = await codaSelectorAttachments['coda.columns'].execute(
        selectorArgs(
          'coda.columns',
          { kind: 'list' },
          { docId: state.docId, tableId: state.tableId }
        )
      )
      log('selector coda.columns', columnOptions)
      expect(columnOptions.kind === 'list' && columnOptions.items.length).toBeGreaterThanOrEqual(2)

      const inserted = await runOk({
        operation: 'upsert_rows',
        docId: state.docId,
        tableId: state.tableId,
        rows: JSON.stringify([
          { Name: 'Alpha', Status: 'Open' },
          { cells: [{ column: state.nameColumnId, value: 'Beta' }] },
        ]),
      })
      expect(inserted.addedRowIds).toHaveLength(2)
      await waitForMutation(inserted.requestId)

      const upserted = await runOk({
        operation: 'upsert_rows',
        docId: state.docId,
        tableId: state.tableId,
        rows: [{ Name: 'Alpha', Status: 'Done' }],
        keyColumns: 'Name',
        disableParsing: true,
      })
      expect(upserted.addedRowIds).toEqual([])
      await waitForMutation(upserted.requestId)

      const rows = await runOk({
        operation: 'list_rows',
        docId: state.docId,
        tableId: state.tableId,
        useColumnNames: true,
        rowSortBy: 'updatedAt',
        valueFormat: 'simpleWithArrays',
        limit: '50',
      })
      const alpha = rows.rows.find(
        (r: { values: Record<string, unknown> }) => r.values.Name === 'Alpha'
      )
      expect(alpha?.values.Status).toBe('Done')
      expect(rows.nextSyncToken).toBeTruthy()
      state.rowIds = rows.rows.map((r: { id: string }) => r.id)

      const filtered = await runOk({
        operation: 'list_rows',
        docId: state.docId,
        tableId: state.tableId,
        rowFilter: `"Name":"Beta"`,
        visibleOnly: true,
      })
      expect(filtered.rows).toHaveLength(1)

      const rowOptions = await codaSelectorAttachments['coda.rows'].execute(
        selectorArgs('coda.rows', { kind: 'list' }, { docId: state.docId, tableId: state.tableId })
      )
      log('selector coda.rows', rowOptions)
      expect(rowOptions.kind === 'list' && rowOptions.items.length).toBe(state.rowIds.length)

      const one = await runOk({
        operation: 'get_row',
        docId: state.docId,
        tableId: state.tableId,
        rowId: alpha.id,
        valueFormat: 'rich',
      })
      expect(one.row.parentTable?.id).toBe(state.tableId)

      const updated = await runOk({
        operation: 'update_row',
        docId: state.docId,
        tableId: state.tableId,
        rowId: alpha.id,
        cells: '{"Status": "Blocked"}',
      })
      await waitForMutation(updated.requestId)
      const changed = await runOk({
        operation: 'list_rows',
        docId: state.docId,
        tableId: state.tableId,
        syncToken: rows.nextSyncToken,
        useColumnNames: true,
      })
      log('rows changed since sync token', changed.rows.length)

      const button = await run({
        operation: 'push_button',
        docId: state.docId,
        tableId: state.tableId,
        rowId: alpha.id,
        columnId: state.nameColumnId,
      })
      expect(button.success).toBe(false)
      expect(button.error).not.toContain('[object Object]')

      const deletedOne = await runOk({
        operation: 'delete_row',
        docId: state.docId,
        tableId: state.tableId,
        rowId: alpha.id,
      })
      await waitForMutation(deletedOne.requestId)
      const remaining = state.rowIds.filter((id) => id !== alpha.id)
      const deletedMany = await runOk({
        operation: 'delete_rows',
        docId: state.docId,
        tableId: state.tableId,
        rowIds: remaining.join(', '),
      })
      expect(deletedMany.rowIds).toEqual(remaining)
      await waitForMutation(deletedMany.requestId)
    },
    TIMEOUT
  )

  it(
    'reads formulas and controls and surfaces missing ones as readable errors',
    async () => {
      const formulas = await runOk({
        operation: 'list_formulas',
        docId: state.docId,
        listSortBy: 'name',
      })
      const controls = await runOk({ operation: 'list_controls', docId: state.docId })
      for (const formula of formulas.formulas) {
        await runOk({ operation: 'get_formula', docId: state.docId, formulaId: formula.id })
      }
      for (const control of controls.controls) {
        await runOk({ operation: 'get_control', docId: state.docId, controlId: control.id })
      }
      const missingFormula = await run({
        operation: 'get_formula',
        docId: state.docId,
        formulaId: 'f-missing',
      })
      expect(missingFormula.success).toBe(false)
      const missingControl = await run({
        operation: 'get_control',
        docId: state.docId,
        controlId: 'ctrl-missing',
      })
      expect(missingControl.success).toBe(false)
      const automation = await run({
        operation: 'trigger_automation',
        docId: state.docId,
        ruleId: 'grid-auto-missing',
        payload: '{"hello":"world"}',
      })
      expect(automation.success).toBe(false)
      expect(automation.error).not.toContain('[object Object]')
      for (const key of ['coda.formulas', 'coda.controls'] as const) {
        const result = await codaSelectorAttachments[key].execute(
          selectorArgs(key, { kind: 'list' }, { docId: state.docId })
        )
        expect(result.kind).toBe('list')
      }
    },
    TIMEOUT
  )

  it(
    'manages sharing settings and permissions',
    async () => {
      const metadata = await runOk({ operation: 'get_sharing_metadata', docId: state.docId })
      expect(metadata.canShare).toBe(true)
      const before = await runOk({ operation: 'get_acl_settings', docId: state.docId })
      const flipped = await runOk({
        operation: 'update_acl_settings',
        docId: state.docId,
        allowCopying: before.allowCopying ? 'false' : 'true',
        allowEditorsToChangePermissions: 'unchanged',
        allowViewersToRequestEditing: 'unchanged',
      })
      expect(flipped.allowCopying).toBe(!before.allowCopying)
      expect(flipped.allowViewersToRequestEditing).toBe(before.allowViewersToRequestEditing)
      await runOk({
        operation: 'update_acl_settings',
        docId: state.docId,
        allowCopying: before.allowCopying ? 'true' : 'false',
      })

      await runOk({
        operation: 'search_principals',
        docId: state.docId,
        principalQuery: state.loginId?.split('@')[0],
      })

      const anyone = await run({
        operation: 'add_permission',
        docId: state.docId,
        access: 'readonly',
        principalType: 'anyone',
      })
      if (!anyone.success) expect(anyone.error).toMatch(/limit/i)
      if (shareEmail) {
        const shared = await runOk({
          operation: 'add_permission',
          docId: state.docId,
          access: 'comment',
          principalType: 'email',
          principal: shareEmail,
          suppressEmail: true,
        })
        expect(shared).toMatchObject({ access: 'comment', principalType: 'email' })
        const permissions = await waitFor('permission', async () => {
          const listed = await runOk({
            operation: 'list_permissions',
            docId: state.docId,
            limit: '20',
          })
          return listed.permissions.find(
            (p: { principal: { email?: string } }) => p.principal.email === shareEmail
          )
        })
        expect(permissions.access).toBe('comment')
        state.permissionId = permissions.id

        const permissionOptions = await codaSelectorAttachments['coda.permissions'].execute(
          selectorArgs('coda.permissions', { kind: 'list' }, { docId: state.docId })
        )
        log('selector coda.permissions', permissionOptions)

        expect(
          permissionOptions.kind === 'list' &&
            permissionOptions.items.some((item) => item.id === state.permissionId)
        ).toBe(true)
        await runOk({
          operation: 'delete_permission',
          docId: state.docId,
          permissionId: state.permissionId,
        })
        await waitFor('permission removal', async () => {
          const listed = await runOk({ operation: 'list_permissions', docId: state.docId })
          return listed.permissions.some((p: { id: string }) => p.id === state.permissionId)
            ? undefined
            : true
        })
      }
      const bad = await run({
        operation: 'add_permission',
        docId: state.docId,
        access: 'readonly',
        principalType: 'email',
        principal: ' ',
      })
      expect(bad.success).toBe(false)
    },
    TIMEOUT
  )

  it(
    'publishes, inspects custom domains, and unpublishes',
    async () => {
      const categories = await runOk({ operation: 'list_categories' })
      const publish = await run({
        operation: 'publish_doc',
        docId: state.docId,
        slug: `sim-coda-e2e-${Date.now()}`,
        publishMode: 'view',
        discoverable: 'false',
        categoryNames: categories.categories[0],
      })
      if (!publish.success) expect(publish.error).toMatch(/maker profile/i)
      if (publish.success) {
        state.published = true
        await waitForMutation(publish.output.requestId)
        const doc = await runOk({ operation: 'get_doc', docId: state.docId })
        log('published doc', doc.doc.published)
      }
      const domains = await runOk({ operation: 'list_custom_domains', docId: state.docId })
      expect(domains.nextPageToken).toBeNull()
      const provider = await runOk({
        operation: 'get_custom_domain_provider',
        customDocDomain: 'example.com',
      })
      expect(provider.provider).toBeTruthy()
      const add = await run({
        operation: 'add_custom_domain',
        docId: state.docId,
        customDocDomain: 'coda-e2e.sim-test.invalid',
      })
      if (!add.success) expect(add.error).toMatch(/plan/i)
      if (add.success) {
        await run({
          operation: 'delete_custom_domain',
          docId: state.docId,
          customDocDomain: 'coda-e2e.sim-test.invalid',
        })
      }
      const unpublish = await run({ operation: 'unpublish_doc', docId: state.docId })
      if (state.published) expect(unpublish.success).toBe(true)
      else if (!unpublish.success) expect(unpublish.error).not.toContain('[object Object]')
    },
    TIMEOUT
  )

  it(
    'reads workspace membership, roles, and analytics',
    async () => {
      const members = await run({
        operation: 'list_workspace_members',
        workspaceId: state.workspaceId,
      })
      if (!members.success) expect(members.error).toMatch(/organization/i)
      await run({
        operation: 'list_workspace_members',
        workspaceId: state.workspaceId,
        includedRoles: 'Admin, DocMaker',
      })
      await run({ operation: 'list_workspace_roles', workspaceId: state.workspaceId })
      if (members.success) {
        const me = members.output.members[0]
        await run({
          operation: 'change_user_role',
          workspaceId: state.workspaceId,
          memberEmail: me.email,
          newRole: me.role,
        })
      }
      await run({
        operation: 'list_doc_analytics',
        docIds: state.docId,
        sinceDate: '2026-01-01',
        untilDate: '2026-12-31',
        analyticsScale: 'cumulative',
        analyticsOrderBy: 'views',
        analyticsDirection: 'descending',
        limit: '10',
      })
      await run({ operation: 'list_doc_analytics', docSearch: 'Sim', isPublished: false })
      await run({ operation: 'list_page_analytics', docId: state.docId, sinceDate: '2026-01-01' })
      await run({
        operation: 'get_doc_analytics_summary',
        sinceDate: '2026-01-01',
        workspaceFilter: state.workspaceId,
      })
    },
    TIMEOUT
  )

  it(
    'copies a doc with formulas, controls, views, and button columns and exercises them',
    async () => {
      const copy = await runOk({
        operation: 'create_doc',
        docTitle: 'Sim Coda E2E Copy',
        sourceDoc: 'BynGmkjg07',
        folderId: state.folderId,
      })
      state.copyDocId = copy.doc.id
      expect(copy.doc.sourceDoc?.id).toBe('BynGmkjg07')
      await waitForDocReady(state.copyDocId!)

      const copies = await runOk({ operation: 'list_docs', sourceDoc: 'BynGmkjg07' })
      expect(copies.docs.map((d: { id: string }) => d.id)).toContain(state.copyDocId)

      const formulas = await runOk({
        operation: 'list_formulas',
        docId: state.copyDocId,
        limit: '100',
      })
      expect(formulas.formulas.length).toBeGreaterThan(0)
      const formula = await runOk({
        operation: 'get_formula',
        docId: state.copyDocId,
        formulaId: formulas.formulas[0].id,
      })
      expect(formula.formula.id).toBe(formulas.formulas[0].id)
      const byName = await runOk({
        operation: 'get_formula',
        docId: state.copyDocId,
        formulaId: formulas.formulas[0].name,
      })
      expect(byName.formula.id).toBe(formulas.formulas[0].id)

      const controls = await runOk({
        operation: 'list_controls',
        docId: state.copyDocId,
        listSortBy: 'name',
      })
      expect(controls.controls.length).toBeGreaterThan(0)
      for (const control of controls.controls) {
        const detail = await runOk({
          operation: 'get_control',
          docId: state.copyDocId,
          controlId: control.id,
        })
        expect(detail.control.controlType).toBeTruthy()
      }
      for (const key of ['coda.formulas', 'coda.controls'] as const) {
        const options = await codaSelectorAttachments[key].execute(
          selectorArgs(key, { kind: 'list' }, { docId: state.copyDocId })
        )
        log(`selector ${key}`, options)
        expect(options.kind === 'list' && options.items.length).toBeGreaterThan(0)
      }

      const views = await runOk({
        operation: 'list_tables',
        docId: state.copyDocId,
        tableTypes: 'view',
      })
      expect(views.tables.length).toBeGreaterThan(0)
      expect(views.tables.every((t: { tableType: string }) => t.tableType === 'view')).toBe(true)
      const view = await runOk({
        operation: 'get_table',
        docId: state.copyDocId,
        tableId: views.tables[0].id,
      })
      expect(view.table.parentTable?.id).toBeTruthy()
      const tableOptions = await codaSelectorAttachments['coda.tables'].execute(
        selectorArgs('coda.tables', { kind: 'list' }, { docId: state.copyDocId })
      )
      expect(
        tableOptions.kind === 'list' &&
          tableOptions.items.some((item) => item.label.endsWith('(view)'))
      ).toBe(true)

      const calendar = await runOk({
        operation: 'list_tables',
        docId: state.copyDocId,
        tableTypes: 'table',
      })
      const calendarTable = calendar.tables.find((t: { name: string }) => t.name === 'My Calendar')
      const richRows = await runOk({
        operation: 'list_rows',
        docId: state.copyDocId,
        tableId: calendarTable.id,
        valueFormat: 'rich',
        rowSortBy: 'natural',
        limit: '5',
      })
      log('rich calendar rows', richRows.rows.slice(0, 2))
      const calendarColumns = await runOk({
        operation: 'list_columns',
        docId: state.copyDocId,
        tableId: 'My Calendar',
      })
      expect(
        calendarColumns.columns.some((c: { format: { type: string } }) => c.format.type === 'date')
      ).toBe(true)

      const tasks = calendar.tables.find((t: { name: string }) => t.name === 'Tasks')
      const taskColumns = await runOk({
        operation: 'list_columns',
        docId: state.copyDocId,
        tableId: tasks.id,
      })
      const buttonColumn = taskColumns.columns.find(
        (c: { format: { type: string } }) => c.format.type === 'button'
      )
      const buttonDetail = await runOk({
        operation: 'get_column',
        docId: state.copyDocId,
        tableId: tasks.id,
        columnId: buttonColumn.id,
      })
      expect(buttonDetail.column.format.type).toBe('button')
      const taskRows = await runOk({
        operation: 'list_rows',
        docId: state.copyDocId,
        tableId: tasks.id,
        limit: '1',
      })
      const rowOptions = await codaSelectorAttachments['coda.rows'].execute(
        selectorArgs(
          'coda.rows',
          { kind: 'detail', id: taskRows.rows[0].id },
          {
            docId: state.copyDocId,
            tableId: tasks.id,
          }
        )
      )
      expect(rowOptions).toMatchObject({ kind: 'detail', item: { id: taskRows.rows[0].id } })
      const pushed = await runOk({
        operation: 'push_button',
        docId: state.copyDocId,
        tableId: tasks.id,
        rowId: taskRows.rows[0].id,
        columnId: buttonColumn.id,
      })
      expect(pushed).toMatchObject({ rowId: taskRows.rows[0].id, columnId: buttonColumn.id })
      await waitForMutation(pushed.requestId)

      const pagesCopy = await runOk({ operation: 'list_pages', docId: state.copyDocId, limit: '3' })
      if (pagesCopy.nextPageToken) {
        const next = await runOk({
          operation: 'list_pages',
          docId: state.copyDocId,
          limit: '3',
          pageToken: pagesCopy.nextPageToken,
        })
        expect(next.pages[0]?.id).not.toBe(pagesCopy.pages[0]?.id)
      }

      await runOk({ operation: 'delete_doc', docId: state.copyDocId })
      state.copyDocId = undefined
    },
    TIMEOUT
  )

  it(
    'resolves browser links and cleans up',
    async () => {
      const resolved = await runOk({
        operation: 'resolve_browser_link',
        browserUrl: state.docBrowserLink,
      })
      expect(resolved.resource.id).toBe(state.docId)
      await runOk({
        operation: 'resolve_browser_link',
        browserUrl: state.docBrowserLink,
        degradeGracefully: true,
      })

      const deleted = await runOk({ operation: 'delete_doc', docId: state.docId })
      expect(deleted.docId).toBe(state.docId)
      state.docId = undefined
      await sleep(5_000)
      const folder = await run({ operation: 'delete_folder', folderId: state.folderId })
      if (folder.success) state.folderId = undefined
    },
    TIMEOUT
  )
})
