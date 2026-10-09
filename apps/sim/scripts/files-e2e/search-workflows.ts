import assert from 'node:assert/strict'
import { sha256Hex } from '@sim/security/hash'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { v2ExecuteWorkflowDataSchema } from '@/lib/api/contracts/v2/workflows'
import { searchWorkspaceFileContentResponseSchema } from '@/lib/api/contracts/workspace-file-search'
import { buildFolderPath } from '@/lib/folders/paths'
import { FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY } from '@/lib/workspace-files/search/constants'
import type { FilesE2EContext } from '@/scripts/files-e2e/types'

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected an object response')
  return value
}

function text(value: unknown): string {
  assert(typeof value === 'string', 'Expected a string response field')
  return value
}

/** Exercises indexing, bounded search and saved File workflows through the running app. */
export async function runSearchWorkflowChecks(context: FilesE2EContext) {
  const { fixture, sql, page, check, json } = context
  const filesPath = `/api/workspaces/${fixture.workspaceId}/files`
  const token = `contents${generateShortId(10).toLowerCase()}`
  const folderName = `Search ${generateShortId(8)}`
  const folder = record(
    (await json(`${filesPath}/folders`, { method: 'POST', body: { name: folderName } })).folder
  )
  const folderId = text(folder.id)
  const folderPath = buildFolderPath([folderName])
  const filename = `${token}.txt`
  const file = record(
    (
      await json(filesPath, {
        method: 'POST',
        expected: 201,
        body: {
          name: filename,
          contentType: 'text/plain',
          folderId,
          content: Array.from(
            { length: 205 },
            (_, i) => `${token} line ${i + 1} <img src=x onerror=alert(1)>`
          ).join('\n'),
        },
      })
    ).file
  )
  const fileId = text(file.id)
  const outsideFile = record(
    (
      await json(filesPath, {
        method: 'POST',
        expected: 201,
        body: {
          name: `${token}-outside.txt`,
          contentType: 'text/plain',
          content: `${token} outside`,
        },
      })
    ).file
  )
  const searchPath = (query: string, scope = folderPath, maxResults = 200) => {
    const params = new URLSearchParams({ query, maxResults: String(maxResults) })
    if (scope) params.set('folderPath', scope)
    return `${filesPath}/search?${params}`
  }
  const search = async (query = token, scope = folderPath, maxResults = 200) =>
    searchWorkspaceFileContentResponseSchema.parse(await json(searchPath(query, scope, maxResults)))

  await check('content search requires a session and rejects invalid bounds', async () => {
    await json(searchPath(token), { authenticated: false, expected: 401 })
    await json(searchPath('ab'), { expected: 400 })
    await json(searchPath(token, folderPath, 201), { expected: 400 })
    await json(searchPath(token, `/missing-${token}`), { expected: 404 })
  })

  await check('real storage bytes become searchable through the index dispatcher', async () => {
    assert(context.cronSecret, 'FILES_E2E_CRON_SECRET must match the app CRON_SECRET')
    for (let attempt = 0; attempt < 30; attempt++) {
      if (attempt % 5 === 0) {
        await json('/api/cron/workspace-file-search-dispatch', {
          authenticated: false,
          headers: { authorization: `Bearer ${context.cronSecret}` },
          expected: [200, 202],
        })
      }
      const response = await json(searchPath(token), { expected: [200, 423] })
      if (typeof response.error !== 'string') {
        const found = searchWorkspaceFileContentResponseSchema.parse(response)
        if (found.results.some((match) => match.fileId === fileId)) return
      }
      await sleep(1000)
    }
    assert.fail('Stored file bytes were not indexed within the bounded polling window')
  })

  await check('content search caps results and metadata to the authorized folder', async () => {
    const found = await search(token, folderPath, 5)
    assert.equal(found.count, 5)
    assert.equal(found.truncated, true)
    assert.deepEqual(found.files, [{ id: fileId, name: filename, folderId }])
    assert(found.results.every((match) => match.fileId === fileId))
    assert.equal('sources' in found, false)
    const bounded = await search()
    assert.equal(bounded.count, 200)
    assert.equal(bounded.truncated, true)
  })

  await check('content search stays bounded on repeated warm requests', async () => {
    for (let request = 0; request < 5; request++) {
      const found = await search()
      assert.equal(found.count, 200)
      assert.equal(found.files.length, 1)
      assert(found.results.every((match) => match.text.length <= 2048))
    }
  })

  await check(
    'content search renders escaped snippets without loading the file inventory',
    async () => {
      const inventories: string[] = []
      const onRequest = (request: { url(): string; method(): string }) => {
        const url = new URL(request.url())
        if (request.method() === 'GET' && url.pathname === filesPath) inventories.push(url.pathname)
      }
      page.on('request', onRequest)
      try {
        const query = new URLSearchParams({ search: token, 'search-mode': 'contents', folderId })
        const response = await page.goto(
          new URL(`/workspace/${fixture.workspaceId}/files?${query}`, context.baseUrl).href,
          { waitUntil: 'domcontentloaded' }
        )
        assert(response, 'Expected the Contents page response')
        assert.equal(
          (await response.text()).includes(text(outsideFile.id)),
          false,
          'Contents mode embedded the workspace inventory in its server response'
        )
        const results = page.getByRole('region', { name: 'File content search results' })
        await results.getByRole('link').first().waitFor()
        assert.equal(await results.getByRole('link').count(), 200)
        assert.equal(await results.locator('img').count(), 0)
        assert((await results.innerText()).includes('<img src=x onerror=alert(1)>'))
        assert.equal(inventories.length, 0, 'Contents mode fetched the entire workspace inventory')
      } finally {
        page.off('request', onRequest)
      }
    }
  )

  await check(
    'content search cannot select or delete hidden filename rows and preserves browser find',
    async () => {
      const namesQuery = new URLSearchParams({ search: token, folderId })
      await page.goto(
        new URL(`/workspace/${fixture.workspaceId}/files?${namesQuery}`, context.baseUrl).href,
        { waitUntil: 'domcontentloaded' }
      )
      await page.getByText(filename, { exact: true }).first().waitFor()
      await page.getByRole('radio', { name: 'Contents', exact: true }).click()
      const results = page.getByRole('region', { name: 'File content search results' })
      await results.getByRole('link').first().waitFor()
      await results.click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Delete')
      await sleep(200)
      const deletionOpened = await page.getByRole('dialog', { name: /^Delete / }).count()
      if (deletionOpened) await page.keyboard.press('Escape')
      await results.click({ position: { x: 5, y: 5 } })
      await page.evaluate(() => {
        document.documentElement.dataset.filesE2eFindPrevented = 'pending'
        const inspectFind = (event: KeyboardEvent) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            document.documentElement.dataset.filesE2eFindPrevented = String(event.defaultPrevented)
            window.removeEventListener('keydown', inspectFind)
          }
        }
        window.addEventListener('keydown', inspectFind)
      })
      await page.keyboard.press('ControlOrMeta+f')
      const findPrevented = await page.evaluate(() => {
        const result = document.documentElement.dataset.filesE2eFindPrevented
        delete document.documentElement.dataset.filesE2eFindPrevented
        return result
      })
      assert.deepEqual(
        { deletionOpened, findPrevented },
        { deletionOpened: 0, findPrevented: 'false' },
        'Contents mode must not invoke hidden filename-list selection or find commands'
      )
    }
  )

  for (const keepBusy of [false, true]) {
    await check(
      keepBusy
        ? 'busy content search stops after one retry and recovers through refresh'
        : 'content search automatically recovers from temporary real read-slot contention',
      async () => {
        const query = `${token} line ${keepBusy ? '2' : '1'}`
        const statuses: number[] = []
        const matchesSearch = (url: string) => {
          const target = new URL(url)
          return (
            target.pathname === `${filesPath}/search` && target.searchParams.get('query') === query
          )
        }
        const onResponse = (response: { url(): string; status(): number }) => {
          if (matchesSearch(response.url())) statuses.push(response.status())
        }
        const lock = await sql.reserve()
        let transactionOpen = false
        page.on('response', onResponse)
        try {
          await lock`BEGIN`
          transactionOpen = true
          await lock`SELECT pg_advisory_xact_lock(hashtextextended(
            'workspace-file-search-read:workspace:' || ${fixture.workspaceId} || ':' || slot::text, 0))
            FROM generate_series(1, ${FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY}) slot`
          const busy = page.waitForResponse(
            (response) => matchesSearch(response.url()) && response.status() === 423
          )
          const params = new URLSearchParams({ search: query, 'search-mode': 'contents', folderId })
          await page.goto(
            new URL(`/workspace/${fixture.workspaceId}/files?${params}`, context.baseUrl).href,
            { waitUntil: 'domcontentloaded' }
          )
          await busy
          if (keepBusy) {
            await page.getByRole('button', { name: 'Try again', exact: true }).waitFor()
            await sleep(1500)
            assert.deepEqual(statuses, [423, 423], 'Search must stop after its single retry')
          }
          await lock`ROLLBACK`
          transactionOpen = false
          if (keepBusy) await page.getByRole('button', { name: 'Try again', exact: true }).click()
          const results = page.getByRole('region', { name: 'File content search results' })
          await results.getByRole('link').first().waitFor()
          assert.deepEqual(statuses, keepBusy ? [423, 423, 200] : [423, 200])
        } finally {
          if (transactionOpen) await lock`ROLLBACK`
          lock.release()
          page.off('response', onResponse)
        }
      }
    )
  }

  const personalKey = `sk-sim-files-fixture-${generateId()}`
  await sql`insert into api_key (id, user_id, name, key, key_hash, type)
    values (${generateId()}, ${fixture.ownerId}, 'Files workflow fixture', ${personalKey}, ${sha256Hex(personalKey)}, 'personal')`

  async function saveWorkflow(visibility: 'public' | 'private', advanced: boolean) {
    const workflowId = generateId()
    const startId = generateId()
    const searchId = generateId()
    const shareId = generateId()
    const subBlock = (id: string, type: string, value: unknown) => ({ id, type, value })
    const pathField = advanced ? 'manualFolderPath' : 'folderPath'
    await sql.begin(async (tx) => {
      await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
        values (${workflowId}, ${fixture.ownerId}, ${fixture.workspaceId}, ${`Files ${visibility} workflow`}, now(), now(), now())`
      const blocks = [
        {
          id: startId,
          name: 'Start',
          type: 'start_trigger',
          subBlocks: { inputFormat: subBlock('inputFormat', 'input-format', []) },
          data: {},
        },
        {
          id: searchId,
          name: 'Search',
          type: 'file_v5',
          subBlocks: {
            operation: subBlock('operation', 'dropdown', 'file_search'),
            query: subBlock('query', 'short-input', token),
            mode: subBlock('mode', 'dropdown', 'exact'),
            maxResults: subBlock('maxResults', 'short-input', '5'),
            folderSelection: subBlock('folderSelection', 'folder-selector', folderPath),
          },
          data: {},
        },
        {
          id: shareId,
          name: 'Share',
          type: 'file_v5',
          subBlocks: {
            operation: subBlock('operation', 'dropdown', 'file_manage_folder_sharing'),
            [pathField]: subBlock(
              pathField,
              advanced ? 'short-input' : 'folder-selector',
              folderPath
            ),
            shareVisibility: subBlock('shareVisibility', 'dropdown', visibility),
          },
          data: { canonicalModes: { folderRef: advanced ? 'advanced' : 'basic' } },
        },
      ]
      for (const [index, block] of blocks.entries()) {
        await tx`insert into workflow_blocks (id, workflow_id, type, name, position_x, position_y, sub_blocks, data)
          values (${block.id}, ${workflowId}, ${block.type}, ${block.name}, ${index * 300}, 0, ${JSON.stringify(block.subBlocks)}::text::jsonb, ${JSON.stringify(block.data)}::text::jsonb)`
      }
      for (const [source, target] of [
        [startId, searchId],
        [searchId, shareId],
      ]) {
        await tx`insert into workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
          values (${generateId()}, ${workflowId}, ${source}, ${target}, 'source', 'target')`
      }
    })
    return workflowId
  }

  async function executeWorkflow(workflowId: string) {
    const response = await json(`/api/v2/workflows/${workflowId}/execute`, {
      method: 'POST',
      authenticated: false,
      headers: { 'x-api-key': personalKey },
      body: {
        run: { source: 'manual' },
        selectedOutputs: ['Search.count', 'Search.truncated', 'Share.url', 'Share.isActive'],
      },
      timeoutMs: 300_000,
    })
    const data = v2ExecuteWorkflowDataSchema.parse(response.data)
    assert.equal(data.status, 'completed', data.error?.message)
    assert.equal(data.blockOutputs?.['Search.count'], 5)
    assert.equal(data.blockOutputs?.['Search.truncated'], true)
    return data
  }

  let shareToken = ''
  await check(
    'a saved File v5 workflow searches files and shares the selected folder',
    async () => {
      const result = await executeWorkflow(await saveWorkflow('public', false))
      assert.equal(result.blockOutputs?.['Share.isActive'], true)
      const url = new URL(text(result.blockOutputs?.['Share.url']))
      shareToken = url.pathname.split('/').at(-1) ?? ''
      assert(shareToken)
      const listing = await json(`/api/files/public/${shareToken}/folder`, { authenticated: false })
      assert.equal(record(listing.folder).id, folderId)
    }
  )

  await check('the advanced File folder path revokes its existing public link', async () => {
    const result = await executeWorkflow(await saveWorkflow('private', true))
    assert.equal(result.blockOutputs?.['Share.isActive'], false)
    assert.equal(result.blockOutputs?.['Share.url'], '')
    await json(`/api/files/public/${shareToken}/folder`, { authenticated: false, expected: 404 })
  })
}
