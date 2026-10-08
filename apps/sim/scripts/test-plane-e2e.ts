import assert from 'node:assert/strict'
import { open, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { NextRequest } from 'next/server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { planeHandler } from '@/lib/webhooks/providers/plane'
import { planeConnector } from '@/connectors/plane'
import * as planeTools from '@/tools/plane'
import { planeApiUrl, planeHeaders, planeRedirectPolicy } from '@/tools/plane/utils'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

/** Exercises real Plane HTTP APIs and connector reads using disposable projects; optional public ingress verifies signed deliveries. */
const logger = createLogger('PlaneE2E')
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}
const apiKey = (await readFile(required('PLANE_E2E_API_KEY_FILE'), 'utf8')).trim()
const workspaceSlug = required('PLANE_E2E_WORKSPACE_SLUG')
const reportPath = required('PLANE_E2E_REPORT_PATH')
if (process.env.PLANE_E2E_CONTRACT_PATH)
  assert.notEqual(
    resolve(reportPath),
    resolve(process.env.PLANE_E2E_CONTRACT_PATH),
    'Private contracts must use a different path from the sanitized report'
  )
const baseUrl = process.env.PLANE_E2E_BASE_URL
const publicCallback = process.env.PLANE_E2E_CALLBACK_URL
const tools: ToolConfig[] = Object.values(planeTools)
const checks: {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  error?: string
}[] = []
const requests: { operation: string; version: string; status: number }[] = []
const contracts: { operation: string; version: string; response: unknown }[] = []
const projects: { id: string; version: 'v1' | 'v2' }[] = []
let subscription: Record<string, unknown> | undefined
const callbackPath = generateId()
const deliveries: Record<string, unknown>[] = []
const deliveryErrors: string[] = []

function safeError(error: unknown): string {
  return getErrorMessage(error)
    .replaceAll(apiKey, '<credential>')
    .replaceAll(workspaceSlug, '<workspace>')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<resource>')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, '<email>')
}
async function check(name: string, run: () => Promise<void>): Promise<boolean> {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start) })
    return true
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - start),
      error: safeError(error),
    })
    logger.warn('Check failed', { name, error: safeError(error) })
    return false
  }
}
function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a provider object')
  return value
}
function id(value: unknown): string {
  const key = record(value).id
  assert(typeof key === 'string' && key.length > 0, 'Expected a resource ID')
  return key
}
function rows(output: Record<string, unknown>): Record<string, unknown>[] {
  const values = output.results ?? toRecord(output.result).data
  assert(Array.isArray(values), 'Expected provider records')
  return values.map(record)
}
async function call(
  operation: string,
  version: 'v1' | 'v2',
  values: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  await sleep(1500)
  const tool = tools.find((candidate) => candidate.id === operation)
  assert(tool, `Missing operation ${operation}`)
  const params = { apiKey, baseUrl, apiVersion: version, workspace_slug: workspaceSlug, ...values }
  const request = prepareToolRequest(tool, params)
  const options = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: request.body,
    profile: 'configuredEndpoint' as const,
    redirectPolicy: request.redirectPolicy,
    timeout: 30_000,
    maxResponseBytes: 8 * 1024 * 1024,
  }
  const response =
    request.method === 'GET' && tool.request.retry?.enabled
      ? await secureFetchWithRetry(request.url, options, {
          maxRetries: tool.request.retry.maxRetries,
          timeout: options.timeout,
          maxResponseBytes: options.maxResponseBytes,
        })
      : await secureFetchWithValidation(request.url, options, 'Plane E2E instance')

  requests.push({ operation, version, status: response.status })
  const responseBody = await response.text()
  if (operation === 'plane_create_project') {
    const created = record(JSON.parse(responseBody))
    if (typeof created.id === 'string') projects.push({ id: created.id, version })
  }
  if (
    response.headers.get('content-type')?.includes('application/json') &&
    !operation.includes('regenerate')
  ) {
    contracts.push({ operation, version, response: JSON.parse(responseBody) })
  }
  if (!response.ok && !response.headers.get('content-type')?.includes('application/json'))
    contracts.push({ operation, version, response: { error_text: responseBody } })
  assert(response.ok, `${operation} (${version}) returned HTTP ${response.status}`)
  let result = await tool.transformResponse?.(
    new Response(response.status === 204 ? null : responseBody, {
      status: response.status,
      headers: response.headers.toRecord(),
    }),
    params
  )
  assert(result?.success, `${operation} did not return a successful tool response`)
  if (tool.postProcess)
    result = await tool.postProcess(result, params, async (childOperation, childParams) => ({
      success: true,
      output: await call(
        childOperation,
        childParams.apiVersion === 'v1' ? 'v1' : 'v2',
        childParams
      ),
    }))
  assert(result.success, `${operation} did not complete its required follow-up operations`)
  return record(result.output)
}

async function receiveDelivery(request: Request): Promise<Response> {
  if (
    new URL(request.url).pathname !== `/api/webhooks/trigger/${callbackPath}` ||
    request.method !== 'POST'
  )
    return new Response(null, { status: 404 })
  const rawBody = await request.text()
  const providerConfig = subscription ?? {}
  const nextRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: request.headers,
    body: rawBody,
  })
  const auth = await planeHandler.verifyAuth?.({
    webhook: {},
    workflow: {},
    request: nextRequest,
    rawBody,
    requestId: 'plane-e2e',
    providerConfig,
  })
  if (auth) {
    deliveryErrors.push('Signature rejected')
    return auth
  }
  try {
    const body: unknown = JSON.parse(rawBody)
    const match = await planeHandler.matchEvent?.({
      webhook: {},
      workflow: {},
      body,
      request: nextRequest,
      requestId: 'plane-e2e',
      providerConfig,
    })
    if (match === true) {
      const formatted = await planeHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'synthetic', userId: 'synthetic' },
        body,
        headers: {},
        query: {},
        method: 'POST',
        requestId: 'plane-e2e',
      })
      const input = record(formatted?.input)
      deliveries.push({ ...input, dedupKey: planeHandler.extractIdempotencyId?.(body) })
    }
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    deliveryErrors.push(safeError(error))
    return new Response(null, { status: 500 })
  }
}
const server = publicCallback
  ? createServer(async (incoming, outgoing) => {
      if (incoming.method !== 'POST') {
        outgoing.writeHead(405, { Allow: 'POST' })
        outgoing.end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of incoming) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += buffer.length
          if (size > 1024 * 1024) {
            outgoing.writeHead(413)
            outgoing.end()
            return
          }
          chunks.push(buffer)
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) headers.set(name, value.join(', '))
          else if (value !== undefined) headers.set(name, value)
        }
        const response = await receiveDelivery(
          new Request(new URL(incoming.url || '/', publicCallback), {
            method: incoming.method || 'POST',
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        )
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
        outgoing.end(await response.text())
      } catch (error) {
        deliveryErrors.push(safeError(error))
        outgoing.writeHead(500)
        outgoing.end()
      }
    })
  : undefined
server?.listen(Number(process.env.PLANE_E2E_LISTENER_PORT || 49187), '127.0.0.1')
if (server) {
  await check('webhook ingress rejects method probes safely', async () => {
    for (const method of ['GET', 'HEAD']) {
      // boundary-raw-fetch: Exercise the local webhook ingress protocol over real HTTP.
      const response = await fetch(
        `http://127.0.0.1:${process.env.PLANE_E2E_LISTENER_PORT || 49187}/${callbackPath}`,
        { method }
      )
      assert.equal(response.status, 405)
    }
    assert.equal(deliveryErrors.length, 0)
  })
}

try {
  for (const version of ['v2', 'v1'] as const) {
    let ownerId = ''
    await check(`${version}: current user authentication`, async () => {
      const user = record((await call('plane_get_current_user', version)).result)
      assert.equal(typeof user.email, 'string')
      assert.equal(typeof user.id, 'string')
      ownerId = id(user)
    })
    let projectId = ''
    const created = await check(`${version}: create isolated project`, async () => {
      const identifier = `S${generateId().replaceAll('-', '').slice(0, 7).toUpperCase()}`
      const output = await call('plane_create_project', version, {
        name: `Sim API verification ${identifier}`,
        identifier,
        description: 'Disposable synthetic API verification project',
        cycle_view: true,
        module_view: true,
        page_view: true,
      })
      projectId = id(output.result)
    })
    if (!created) continue
    const scope = { project_id: projectId }
    await check(`${version}: project detail and sparse fields`, async () => {
      const output = await call('plane_get_project', version, {
        pk: projectId,
        ...(version === 'v2' ? { fields: 'id,name' } : {}),
      })
      assert.equal(id(output.result), projectId)
      assert.equal(typeof record(output.result).name, 'string')
    })
    await check(`${version}: project listing, update, summary and archival`, async () => {
      assert(
        rows(await call('plane_list_projects', version, { per_page: 100 })).some(
          (row) => id(row) === projectId
        )
      )
      await call('plane_update_project', version, {
        pk: projectId,
        description: 'Updated disposable description',
      })
      assert.equal(
        record((await call('plane_get_project', version, { pk: projectId })).result).description,
        'Updated disposable description'
      )
      assert((await call('plane_get_project_summary', version, { pk: projectId })).result)
      await call('plane_archive_project', version, { pk: projectId })
      await call('plane_unarchive_project', version, { pk: projectId })
    })
    await check(`${version}: state create, read, update and delete`, async () => {
      const state = id(
        (
          await call('plane_create_state', version, {
            ...scope,
            name: 'Synthetic spare state',
            color: '#3F76FF',
            group: 'backlog',
          })
        ).result
      )
      assert.equal(
        id((await call('plane_get_state', version, { ...scope, pk: state })).result),
        state
      )
      await call('plane_update_state', version, {
        ...scope,
        pk: state,
        name: 'Updated spare state',
      })
      assert.equal(
        record((await call('plane_get_state', version, { ...scope, pk: state })).result).name,
        'Updated spare state'
      )
      await call('plane_delete_state', version, { ...scope, pk: state })
    })
    let stateId = ''
    await check(`${version}: list workflow states`, async () => {
      stateId = id(rows(await call('plane_list_states', version, scope))[0])
    })
    let labelId = ''
    await check(`${version}: create label`, async () => {
      labelId = id(
        (
          await call('plane_create_label', version, {
            ...scope,
            name: 'Synthetic label',
            color: '#3F76FF',
          })
        ).result
      )
    })
    await check(`${version}: label detail, listing and update`, async () => {
      assert.equal(
        id((await call('plane_get_label', version, { ...scope, pk: labelId })).result),
        labelId
      )
      assert(
        rows(await call('plane_list_labels', version, scope)).some((row) => id(row) === labelId)
      )
      await call('plane_update_label', version, {
        ...scope,
        pk: labelId,
        name: 'Updated synthetic label',
      })
      assert.equal(
        record((await call('plane_get_label', version, { ...scope, pk: labelId })).result).name,
        'Updated synthetic label'
      )
    })
    const itemIds: string[] = []
    await check(`${version}: create work items with canonical IDs`, async () => {
      for (let index = 0; index < 2; index++) {
        const output = await call('plane_create_work_item', version, {
          ...scope,
          name: `Synthetic work item ${index + 1}`,
          description_html: '<p>Content for connector verification</p>',
          state_id: stateId,
          priority: 'low',
          label_ids: labelId ? [labelId] : [],
          assignee_ids: [],
        })
        const item = record(output.result)
        assert.equal(version === 'v1' ? item.state : item.state_id, stateId)
        const labelValues = version === 'v1' ? item.labels : item.label_ids
        assert(
          Array.isArray(labelValues) && labelValues.includes(labelId),
          'Created work item must retain canonical label IDs'
        )
        itemIds.push(id(item))
      }
    })
    if (itemIds.length < 2) continue
    await check(`${version}: paginated work item listing`, async () => {
      const first = await call('plane_list_work_items', version, {
        ...scope,
        per_page: 1,
        order_by: 'created_at',
      })
      const page = rows(first)
      assert.equal(page.length, 1)
      const next =
        version === 'v1' ? record(first.pagination).next_cursor : record(first.result).next
      assert(next !== null && next !== undefined, 'Provider must expose a next page')
      const second = await call('plane_list_work_items', version, {
        ...scope,
        per_page: 1,
        order_by: 'created_at',
        ...(version === 'v1' ? { cursor: next } : { offset: next }),
      })
      assert.equal(rows(second).length, 1)
      assert.notEqual(id(page[0]), id(rows(second)[0]), 'Pagination must advance')
    })
    if (version === 'v2')
      await check('v2: cursor pagination and comma-separated filters', async () => {
        const first = await call('plane_list_work_items', version, {
          ...scope,
          per_page: 1,
          order_by: 'created_at',
          paginate: 'cursor',
          priority__in: 'low,high',
          expand: 'state,labels',
        })
        const envelope = record(first.result)
        assert.equal(record(envelope.pagination).style, 'cursor')
        assert.equal(envelope.has_more, true)
        assert.equal(typeof record(rows(first)[0]).state, 'object')
        const second = await call('plane_list_work_items', version, {
          ...scope,
          per_page: 1,
          order_by: 'created_at',
          cursor: envelope.next_cursor,
          priority__in: 'low,high',
          expand: 'state,labels',
        })
        assert.notEqual(id(rows(first)[0]), id(rows(second)[0]))
      })
    await check(`${version}: work item lookup by identifier`, async () => {
      const detail = record(
        (await call('plane_get_work_item', version, { ...scope, pk: itemIds[0] })).result
      )
      const project = record((await call('plane_get_project', version, { pk: projectId })).result)
      const identifier = detail.identifier ?? `${project.identifier}-${detail.sequence_id}`
      if (version === 'v2')
        assert.equal(
          id((await call('plane_get_work_item_by_identifier', version, { identifier })).result),
          itemIds[0]
        )
      else
        await assert.rejects(
          call('plane_get_work_item_by_identifier', version, { identifier }),
          /requires API v2/
        )
      if (version === 'v2')
        assert(
          rows(
            await call('plane_list_workspace_work_items', version, { ...scope, per_page: 10 })
          ).some((row) => id(row) === itemIds[0])
        )
    })
    await check(`${version}: comments CRUD`, async () => {
      const itemScope = { ...scope, work_item_id: itemIds[0] }
      const commentId = id(
        (
          await call('plane_create_comment', version, {
            ...itemScope,
            comment_html: '<p>Synthetic comment</p>',
          })
        ).result
      )
      assert.equal(
        id((await call('plane_get_comment', version, { ...itemScope, pk: commentId })).result),
        commentId
      )
      assert(
        rows(await call('plane_list_comments', version, itemScope)).some(
          (row) => id(row) === commentId
        )
      )
      await call('plane_update_comment', version, {
        ...itemScope,
        pk: commentId,
        comment_html: '<p>Updated comment</p>',
      })
      assert(
        record((await call('plane_get_comment', version, { ...itemScope, pk: commentId })).result)
          .comment_html?.toString()
          .includes('Updated comment')
      )
      await call('plane_delete_comment', version, { ...itemScope, pk: commentId })
    })
    await check(`${version}: links CRUD and metadata`, async () => {
      const itemScope = { ...scope, work_item_id: itemIds[0] }
      const linkId = id(
        (
          await call('plane_create_link', version, {
            ...itemScope,
            url: 'https://example.com/plane-e2e',
            title: 'Synthetic link',
            ...(version === 'v2' ? { metadata: { source: 'synthetic' } } : {}),
          })
        ).result
      )
      assert.equal(
        id((await call('plane_get_link', version, { ...itemScope, pk: linkId })).result),
        linkId
      )
      assert(
        rows(await call('plane_list_links', version, itemScope)).some((row) => id(row) === linkId)
      )
      await call('plane_update_link', version, { ...itemScope, pk: linkId, title: 'Updated link' })
      assert.equal(
        record((await call('plane_get_link', version, { ...itemScope, pk: linkId })).result).title,
        'Updated link'
      )
      await call('plane_delete_link', version, { ...itemScope, pk: linkId })
    })
    await check(
      `${version}: attachment initialization, upload, confirmation and deletion`,
      async () => {
        const itemScope = { ...scope, work_item_id: itemIds[0] }
        const content = 'Disposable Plane attachment verification'
        const created = record(
          (
            await call('plane_create_attachment_upload', version, {
              ...itemScope,
              name: 'verification.txt',
              size: content.length + 16 * 1024,
              type: 'text/plain',
            })
          ).result
        )
        const attachmentId = id(created.attachment)
        const upload = record(created.upload_data)
        assert.equal(typeof upload.url, 'string')
        const fields = record(upload.fields)
        const form = new FormData()
        for (const [name, value] of Object.entries(fields)) {
          assert.equal(typeof value, 'string')
          form.append(name, String(value))
        }
        form.append('file', new Blob([content], { type: 'text/plain' }), 'verification.txt')
        const encodedUpload = new Request(String(upload.url), { method: 'POST', body: form })
        const uploadContentType = encodedUpload.headers.get('content-type')
        assert(uploadContentType, 'Multipart upload must include its boundary')
        const stored = await secureFetchWithValidation(
          String(upload.url),
          {
            method: 'POST',
            body: Buffer.from(await encodedUpload.arrayBuffer()),
            headers: {
              'Content-Type': uploadContentType,
              'User-Agent': planeHeaders(apiKey)['User-Agent'],
            },
            profile: 'contentFetch',
            timeout: 30_000,
            maxResponseBytes: 1024 * 1024,
          },
          'Plane signed attachment upload'
        )
        assert(stored.ok, `Signed storage upload returned HTTP ${stored.status}`)
        await call('plane_confirm_attachment_upload', version, {
          ...itemScope,
          pk: attachmentId,
          is_uploaded: true,
        })
        if (version === 'v2') {
          const detail = record(
            (await call('plane_get_attachment', version, { ...itemScope, pk: attachmentId })).result
          )
          assert.equal(detail.is_uploaded, true)
        } else {
          await assert.rejects(
            call('plane_get_attachment', version, { ...itemScope, pk: attachmentId }),
            /requires API v2/
          )
        }
        const listedAttachment = rows(
          await call('plane_list_attachments', version, itemScope)
        ).find((row) => id(row) === attachmentId)
        assert.equal(listedAttachment?.is_uploaded, true)
        await call('plane_delete_attachment', version, { ...itemScope, pk: attachmentId })
      }
    )
    await check(`${version}: knowledge connector content and cap`, async () => {
      const config = { workspaceSlug, projectId, baseUrl }
      assert.equal((await planeConnector.validateConfig(apiKey, config)).valid, true)
      const listing = await planeConnector.listDocuments(apiKey, config)
      assert.equal(listing.documents.length, 2)
      assert(
        listing.documents.every((doc) => doc.content.includes('Content for connector verification'))
      )
      const hydrated = await planeConnector.getDocument(apiKey, config, `work_item:${itemIds[0]}`)
      assert(hydrated?.content.includes('Content for connector verification'))
      assert.equal(
        (await planeConnector.validateConfig(apiKey, { ...config, maxDocuments: true })).valid,
        false
      )
      const cappedContext: Record<string, unknown> = { totalDocsFetched: 0 }
      const capped = await planeConnector.listDocuments(
        apiKey,
        { ...config, maxDocuments: 1 },
        undefined,
        cappedContext
      )
      assert.equal(cappedContext.listingCapped, true)
      assert.equal(capped.documents.length, 1)
      assert.equal(capped.hasMore, false)
      assert.equal(capped.reconciliationSafe, false)
    })
    await check(`${version}: update with explicit clearing`, async () => {
      await call('plane_update_work_item', version, {
        ...scope,
        pk: itemIds[0],
        parent_id: itemIds[1],
        assignee_ids: [ownerId],
      })
      const before = record(
        (await call('plane_get_work_item', version, { ...scope, pk: itemIds[0] })).result
      )
      assert.equal(version === 'v1' ? before.parent : before.parent_id, itemIds[1])
      const assigned = version === 'v1' ? before.assignees : before.assignee_ids
      assert(Array.isArray(assigned))
      assert.deepEqual(
        assigned.map((value) => (typeof value === 'string' ? value : id(value))),
        [ownerId]
      )
      await call('plane_update_work_item', version, {
        ...scope,
        pk: itemIds[0],
        priority: 'high',
        bodyOverrides: { description_html: '', label_ids: [], assignee_ids: [], parent_id: null },
      })
      const document = await planeConnector.getDocument(
        apiKey,
        { workspaceSlug, projectId, baseUrl },
        `work_item:${itemIds[0]}`
      )
      assert(document && !document.content.includes('Content for connector verification'))
      assert(document.content.includes('Priority: high'))
      const item = record(
        (await call('plane_get_work_item', 'v1', { ...scope, pk: itemIds[0] })).result
      )
      assert.deepEqual(item.labels, [], 'Label clearing was not persisted')
      assert.deepEqual(item.assignees, [], 'Assignee clearing was not persisted')
      assert.equal(item.parent, null)
    })
    await check(`${version}: cycle and module CRUD`, async () => {
      const cycleId = id(
        (
          await call('plane_create_cycle', version, {
            ...scope,
            name: 'Synthetic cycle',
            start_date: '2030-01-01',
            end_date: '2030-01-14',
          })
        ).result
      )
      const moduleId = id(
        (
          await call('plane_create_module', version, {
            ...scope,
            name: 'Synthetic module',
            status: 'backlog',
          })
        ).result
      )
      for (const operation of ['plane_manage_cycle_work_items', 'plane_manage_module_work_items']) {
        const membershipTool = tools.find((tool) => tool.id === operation)
        assert(membershipTool)
        assert.throws(
          () =>
            prepareToolRequest(membershipTool, {
              apiKey,
              baseUrl,
              apiVersion: 'v1',
              workspace_slug: workspaceSlug,
              project_id: projectId,
              pk: cycleId,
              remove: ['valid-id', '../escape'],
            }),
          'Invalid later IDs must fail before the first mutation'
        )
      }
      await call('plane_manage_cycle_work_items', version, { ...scope, pk: cycleId, add: itemIds })
      await call('plane_manage_module_work_items', version, {
        ...scope,
        pk: moduleId,
        add: itemIds,
      })
      assert.equal(
        record((await call('plane_get_cycle', 'v1', { ...scope, pk: cycleId })).result)
          .total_issues,
        itemIds.length
      )
      assert.equal(
        record((await call('plane_get_module', 'v1', { ...scope, pk: moduleId })).result)
          .total_issues,
        itemIds.length
      )
      await call('plane_manage_cycle_work_items', version, {
        ...scope,
        pk: cycleId,
        remove: itemIds,
      })
      await call('plane_manage_module_work_items', version, {
        ...scope,
        pk: moduleId,
        remove: itemIds,
      })
      assert.equal(
        record((await call('plane_get_cycle', 'v1', { ...scope, pk: cycleId })).result)
          .total_issues,
        0
      )
      assert.equal(
        record((await call('plane_get_module', 'v1', { ...scope, pk: moduleId })).result)
          .total_issues,
        0
      )
      await call('plane_update_cycle', version, {
        ...scope,
        pk: cycleId,
        name: 'Updated synthetic cycle',
      })
      await call('plane_update_module', version, {
        ...scope,
        pk: moduleId,
        name: 'Updated synthetic module',
      })
      assert.equal(
        id((await call('plane_get_cycle', version, { ...scope, pk: cycleId })).result),
        cycleId
      )
      assert.equal(
        id((await call('plane_get_module', version, { ...scope, pk: moduleId })).result),
        moduleId
      )
      assert(
        rows(await call('plane_list_cycles', version, scope)).some((row) => id(row) === cycleId)
      )
      assert(
        rows(await call('plane_list_modules', version, scope)).some((row) => id(row) === moduleId)
      )
      const destination = id(
        (
          await call('plane_create_cycle', version, {
            ...scope,
            name: 'Destination cycle',
            start_date: '2030-02-01',
            end_date: '2030-02-14',
          })
        ).result
      )
      await call('plane_manage_cycle_work_items', version, {
        ...scope,
        pk: cycleId,
        add: [itemIds[0]],
      })
      await call('plane_update_cycle', version, {
        ...scope,
        pk: cycleId,
        start_date: '2020-01-01',
        end_date: '2020-01-14',
      })
      await call('plane_transfer_cycle_work_items', version, {
        ...scope,
        pk: cycleId,
        new_cycle_id: destination,
      })
      assert.equal(
        record((await call('plane_get_cycle', 'v1', { ...scope, pk: destination })).result)
          .total_issues,
        1
      )
      await call('plane_delete_cycle', version, { ...scope, pk: destination })
      await call('plane_delete_cycle', version, { ...scope, pk: cycleId })
      await call('plane_delete_module', version, { ...scope, pk: moduleId })
    })
    await check(`${version}: page connector hydration`, async () => {
      const pageId = id(
        (
          await call('plane_create_project_page', version, {
            ...scope,
            name: 'Synthetic page',
            description_html: '<p>Page connector content</p>',
          })
        ).result
      )
      assert.equal(
        id((await call('plane_get_project_page', version, { ...scope, pk: pageId })).result),
        pageId
      )
      assert(
        rows(await call('plane_list_project_pages', version, scope)).some(
          (row) => id(row) === pageId
        )
      )
      const config = { workspaceSlug, projectId, baseUrl, contentType: 'pages' }
      assert.equal((await planeConnector.validateConfig(apiKey, config)).valid, true)
      const list = await planeConnector.listDocuments(apiKey, config)
      const stub = list.documents.find((doc) => doc.externalId === `page:${pageId}`)
      assert(stub?.contentDeferred)
      const detail = await planeConnector.getDocument(apiKey, config, `page:${pageId}`)
      assert(detail, 'Expected a hydrated page')
      assert(detail.content.includes('Page connector content'))
      assert.equal(stub.contentHash, detail.contentHash)
      await call('plane_update_project_page', version, {
        ...scope,
        pk: pageId,
        description_html: '<p>Updated page content</p>',
      })
      assert(
        (await planeConnector.getDocument(apiKey, config, `page:${pageId}`))?.content.includes(
          'Updated page content'
        )
      )
      if (version === 'v1') {
        const archived = await secureFetchWithValidation(
          planeApiUrl(
            baseUrl,
            `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/pages/${pageId}/archive/`
          ),
          {
            method: 'POST',
            headers: planeHeaders(apiKey),
            profile: 'configuredEndpoint',
            redirectPolicy: planeRedirectPolicy(),
            timeout: 30_000,
            maxResponseBytes: 1024 * 1024,
          },
          'Plane disposable page cleanup'
        )
        assert(archived.ok, `Page fixture archive returned HTTP ${archived.status}`)
      } else
        await call('plane_update_project_page', version, {
          ...scope,
          pk: pageId,
          archived_at: new Date().toISOString(),
        })
      await call('plane_delete_project_page', version, { ...scope, pk: pageId })
      assert.equal(await planeConnector.getDocument(apiKey, config, `page:${pageId}`), null)
    })
    if (version === 'v2' && publicCallback)
      await check('v2: automatic webhook lifecycle and signed delivery', async () => {
        const initialConfig = {
          autoRegister: true,
          triggerId: 'plane_workitem_created',
          triggerWorkspaceSlug: workspaceSlug,
          triggerApiKey: apiKey,
          triggerBaseUrl: baseUrl,
          projectId,
        }
        const webhook = { path: callbackPath, providerConfig: initialConfig }
        const created = await planeHandler.createSubscription?.({
          webhook,
          workflow: {},
          userId: 'synthetic',
          requestId: 'plane-e2e',
          request: new NextRequest(`${publicCallback}/api/webhooks/trigger/${callbackPath}`),
        })
        subscription = { ...initialConfig, ...created?.providerConfigUpdates }
        assert.equal(typeof subscription.webhookSecret, 'string')
        const pending = await call('plane_get_webhook', 'v2', {
          workspace_slug: workspaceSlug,
          pk: subscription.externalId,
        })
        assert.equal(
          toRecord(pending.result).is_active,
          false,
          'Subscription must remain inactive until its credentials are persisted'
        )
        await planeHandler.activateSubscription?.({
          webhook: { ...webhook, providerConfig: subscription },
          workflow: {},
          userId: 'synthetic',
          requestId: 'plane-e2e',
          request: new NextRequest(`${publicCallback}/api/webhooks/trigger/${callbackPath}`),
        })
        const active = record(
          (await call('plane_get_webhook', 'v2', { pk: subscription.externalId })).result
        )
        assert.equal(active.is_active, true)
        const recovered = await planeHandler.createSubscription?.({
          webhook: { ...webhook, providerConfig: subscription },
          workflow: {},
          userId: 'synthetic',
          requestId: 'plane-e2e',
          request: new NextRequest(`${publicCallback}/api/webhooks/trigger/${callbackPath}`),
        })
        assert.equal(
          recovered?.providerConfigUpdates?.externalId,
          subscription.externalId,
          'Retry must reuse the tracked subscription'
        )
        await call('plane_create_work_item', version, {
          ...scope,
          name: 'Synthetic signed webhook event',
        })
        const deadline = Date.now() + 45_000
        while (!deliveries.length && !deliveryErrors.length && Date.now() < deadline)
          await sleep(500)
        assert.equal(deliveryErrors.length, 0, 'Real delivery failed authentication or processing')
        assert.equal(deliveries.length, 1, 'Expected a real signed provider delivery')
        assert.equal(deliveries[0].eventName, 'workitem.created')
        assert.equal(typeof deliveries[0].dedupKey, 'string')
        await planeHandler.deleteSubscription?.({
          webhook: { ...webhook, providerConfig: subscription },
          workflow: {},
          requestId: 'plane-e2e',
          strict: true,
        })
        subscription = undefined
      })
    if (version === 'v2')
      await check('v2: webhook tools CRUD and secret rotation', async () => {
        const webhookId = id(
          (
            await call('plane_create_webhook', version, {
              url: 'https://example.com/plane-e2e',
              name: 'Inactive synthetic webhook',
              is_active: false,
              version: 'v2',
              scopes: ['workitem.created'],
            })
          ).result
        )
        try {
          assert(
            rows(await call('plane_list_webhooks', version)).some((row) => id(row) === webhookId)
          )
          await call('plane_update_webhook', version, {
            pk: webhookId,
            name: 'Updated inactive webhook',
          })
          assert.equal(
            record((await call('plane_get_webhook', version, { pk: webhookId })).result).name,
            'Updated inactive webhook'
          )
          const rotated = record(
            (await call('plane_regenerate_webhook_secret', version, { pk: webhookId })).result
          )
          assert.equal(typeof rotated.secret_key, 'string')
        } finally {
          await call('plane_delete_webhook', version, { pk: webhookId })
        }
      })
    if (version === 'v2')
      await check('v2: work item archival preserves identity and relationship fields', async () => {
        const archived = record(
          (
            await call('plane_archive_work_item', version, {
              ...scope,
              pk: itemIds[1],
              fields: 'id,project_id,cycle_id,module_ids,archived_at',
            })
          ).result
        )
        assert.equal(id(archived), itemIds[1])
        assert.equal(archived.project_id, projectId)
        assert(Object.hasOwn(archived, 'cycle_id') && Object.hasOwn(archived, 'module_ids'))
        assert.equal(typeof archived.archived_at, 'string')
        await call('plane_unarchive_work_item', version, { ...scope, pk: itemIds[1] })
      })
    await check(`${version}: label deletion`, async () => {
      await call('plane_delete_label', version, { ...scope, pk: labelId })
    })
    await check(`${version}: work item deletion and connector missing read`, async () => {
      await call('plane_delete_work_item', version, { ...scope, pk: itemIds[1] })
      try {
        const missing = await planeConnector.getDocument(
          apiKey,
          { workspaceSlug, projectId, baseUrl },
          `work_item:${itemIds[1]}`
        )
        assert.equal(missing, null)
      } catch (error) {
        assert.match(getErrorMessage(error), /Plane document read failed \(HTTP 403\)/)
      }
    })
  }
  await check(
    'v1: knowledge connector preserves distinct capped cursor continuations',
    async () => {
      const projectId = id(
        (
          await call('plane_create_project', 'v1', {
            name: 'Disposable cursor verification',
            identifier: `P${generateId().replaceAll('-', '').slice(0, 7).toUpperCase()}`,
          })
        ).result
      )
      const itemIds: string[] = []
      for (let index = 0; index < 102; index++) {
        itemIds.push(
          id(
            (
              await call('plane_create_work_item', 'v1', {
                project_id: projectId,
                name: `Cursor verification ${index}`,
              })
            ).result
          )
        )
      }
      for (const maxDocuments of [101, 102]) {
        const config = { workspaceSlug, projectId, baseUrl, maxDocuments }
        const context: Record<string, unknown> = { totalDocsFetched: 0 }
        const externalIds: string[] = []
        let cursor: string | undefined
        let hasMore = true
        for (let page = 0; page < itemIds.length && hasMore; page++) {
          const listing = await planeConnector.listDocuments(apiKey, config, cursor, context)
          externalIds.push(...listing.documents.map((document) => document.externalId))
          cursor = listing.nextCursor
          hasMore = listing.hasMore
          if (hasMore) assert(cursor, 'A continuing listing must provide its next cursor')
        }
        assert.equal(hasMore, false)
        assert.equal(cursor, undefined)
        assert.deepEqual(
          externalIds,
          itemIds.slice(0, maxDocuments).map((itemId) => `work_item:${itemId}`)
        )
        assert.equal(context.totalDocsFetched, maxDocuments)
        if (maxDocuments < itemIds.length) assert.equal(context.listingCapped, true)
        else assert.notEqual(context.listingCapped, true)
      }
    }
  )
  if (!publicCallback)
    checks.push({
      name: 'Signed public webhook delivery',
      status: 'skipped',
      durationMs: 0,
      error:
        'Set PLANE_E2E_CALLBACK_URL and NEXT_PUBLIC_APP_URL to a public URL routed to the listener.',
    })
} finally {
  if (subscription)
    await check('Cleanup webhook subscription', async () => {
      await planeHandler.deleteSubscription?.({
        webhook: { providerConfig: subscription },
        workflow: {},
        requestId: 'plane-e2e',
        strict: true,
      })
    })
  for (const fixture of projects)
    await check(`${fixture.version}: remove disposable project`, async () => {
      await call('plane_delete_project', fixture.version, { pk: fixture.id })
    })
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        checks,
        requests,
        verifiedDeliveries: deliveries.length,
        operations: {
          available: tools.length,
          successfulV2: new Set(
            requests
              .filter(
                (request) =>
                  request.version === 'v2' && request.status >= 200 && request.status < 300
              )
              .map((request) => request.operation)
          ).size,
          unverifiedV2: tools
            .filter(
              (tool) =>
                !requests.some(
                  (request) =>
                    request.operation === tool.id &&
                    request.version === 'v2' &&
                    request.status >= 200 &&
                    request.status < 300
                )
            )
            .map((tool) => tool.id),
        },
      },
      null,
      2
    )
  )
  if (process.env.PLANE_E2E_CONTRACT_PATH) {
    const contractFile = await open(process.env.PLANE_E2E_CONTRACT_PATH, 'a', 0o600)
    try {
      await contractFile.chmod(0o600)
      await contractFile.truncate(0)
      await contractFile.writeFile(JSON.stringify(contracts, null, 2))
    } finally {
      await contractFile.close()
    }
  }
}
logger.info('Plane E2E completed', {
  passed: checks.filter((item) => item.status === 'passed').length,
  failed: checks.filter((item) => item.status === 'failed').length,
  requests: requests.length,
})
if (checks.some((item) => item.status === 'failed')) process.exitCode = 1
