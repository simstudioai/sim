import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toArray, toRecord } from '@sim/utils/object'
import { GoogleAdsBlock } from '@/blocks/blocks/google_ads'
import {
  googleAdsAdPerformanceTool,
  googleAdsCampaignPerformanceTool,
  googleAdsListAdGroupsTool,
  googleAdsListCampaignsTool,
  googleAdsListCustomersTool,
  googleAdsSearchTool,
} from '@/tools/google_ads'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

/** Exercises the real query builders and parsers over synthetic HTTP, not a live Ads account. */
const logger = createLogger('GoogleAdsE2E')
const reportPath = process.env.GOOGLE_ADS_REPORT_PATH
assert(reportPath, 'Set GOOGLE_ADS_REPORT_PATH')
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
let requests = 0
let mode = ''
let firstPageQuery: string | undefined
const server = http.createServer(async (request, response) => {
  requests++
  response.setHeader('Content-Type', 'application/json')
  const send = (status: number, data: unknown) => {
    response.statusCode = status
    response.end(JSON.stringify(data))
  }
  try {
    assert.equal(request.headers.authorization, 'Bearer synthetic-access-token')
    assert.equal(request.headers['developer-token'], undefined)
    if (mode === 'denied') {
      send(403, { error: { message: 'The customer is not accessible.' } })
      return
    }
    if (request.url?.endsWith('/customers:listAccessibleCustomers')) {
      send(200, { resourceNames: ['customers/1234567890'] })
      return
    }
    assert.match(request.url ?? '', /^\/v24\/customers\/1234567890\/googleAds:search$/)
    assert.equal(request.headers['login-customer-id'], '9876543210')
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body: { query: string; pageToken?: string } = JSON.parse(raw)
    assert(!/campaign\.(start_date|end_date)\b/.test(body.query), 'Removed campaign date fields')
    const page = body.pageToken ? 2 : 1
    if (body.pageToken) {
      assert.equal(body.pageToken, 'page-two')
      assert.equal(body.query, firstPageQuery, 'Continuation must preserve the original query')
    } else {
      firstPageQuery = body.query
    }
    const selectedFields = body.query
      .split(/\s+FROM\s+/i)[0]
      .replace(/^SELECT\s+/i, '')
      .split(',')
      .map((field) => field.trim())
    const row = {
      campaign: {
        id: String(page),
        name: `Campaign ${page}`,
        status: 'PAUSED',
        ...(selectedFields.includes('campaign.start_date_time')
          ? { startDateTime: '2026-10-01 00:00:00' }
          : {}),
        ...(selectedFields.includes('campaign.end_date_time')
          ? { endDateTime: '2026-10-31 23:59:59' }
          : {}),
      },
      adGroup: { id: String(page), name: 'Group', status: 'PAUSED' },
      adGroupAd: { ad: { id: String(page), type: 'RESPONSIVE_SEARCH_AD' } },
      metrics: {
        impressions: '9007199254740993',
        clicks: '3',
        costMicros: '1250000',
        ctr: 0.25,
        conversions: 0.5,
      },
      segments: { date: '2026-10-01' },
    }
    send(200, {
      results: mode === 'empty' ? [] : [row],
      totalResultsCount: mode === 'empty' ? '0' : '2',
      ...(page === 1 && mode !== 'empty' ? { nextPageToken: 'page-two' } : {}),
    })
  } catch (error) {
    send(400, { error: { message: getErrorMessage(error) } })
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const params = {
  accessToken: 'synthetic-access-token',
  customerId: '1234567890',
  managerCustomerId: '9876543210',
  campaignId: '1',
}
type Result = { success: boolean; output: Record<string, unknown>; error?: string }
async function invoke<P extends Record<string, unknown>>(
  tool: Omit<ToolConfig<P, Result>, 'postProcess'>,
  input: P
): Promise<Result> {
  const request = prepareToolRequest(tool, input)
  const url = new URL(request.url)
  assert.equal(url.origin, 'https://googleads.googleapis.com')
  // boundary-raw-fetch: fixed loopback fixture receives synthetic credentials and prepared wire data.
  const response = await fetch(`${origin}${url.pathname}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  })
  assert(tool.transformResponse)
  return tool.transformResponse(response, input)
}
async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  mode = ''
  firstPageQuery = undefined
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
  }
}
try {
  await check('OAuth-only customer listing', async () => {
    const result = await invoke(googleAdsListCustomersTool, params)
    assert.equal(result.success, true, result.error)
    assert.deepEqual(result.output.customerIds, ['1234567890'])
  })
  await check('campaign dates use supported fields and preserve date-only outputs', async () => {
    const result = await invoke(googleAdsListCampaignsTool, params)
    assert.equal(result.success, true, result.error)
    assert.equal(toRecord(toArray(result.output.campaigns)[0]).startDate, '2026-10-01')
    assert.equal(toRecord(toArray(result.output.campaigns)[0]).endDate, '2026-10-31')
  })
  await check('copied customer and manager IDs tolerate surrounding spaces', async () => {
    const result = await invoke(googleAdsListAdGroupsTool, {
      ...params,
      customerId: ' 123-456-7890 ',
      managerCustomerId: ' 987-654-3210 ',
    })
    assert.equal(result.success, true, result.error)
  })
  for (const [name, tool, key] of [
    ['campaign list', googleAdsListCampaignsTool, 'campaigns'],
    ['ad group list', googleAdsListAdGroupsTool, 'adGroups'],
    ['campaign report', googleAdsCampaignPerformanceTool, 'campaigns'],
    ['ad report', googleAdsAdPerformanceTool, 'ads'],
    ['custom query', googleAdsSearchTool, 'results'],
  ] as const) {
    await check(`${name} preserves continuation and stops after one page per call`, async () => {
      const input = {
        ...params,
        query: 'SELECT campaign.id FROM campaign',
        pageToken: undefined as string | undefined,
      }
      const typedTool: Omit<ToolConfig<typeof input, Result>, 'postProcess'> = tool
      const before = requests
      const first = await invoke(typedTool, input)
      assert.equal(first.success, true, first.error)
      assert.equal(requests, before + 1)
      assert.equal(first.output.nextPageToken, 'page-two')
      const second = await invoke(typedTool, {
        ...input,
        pageToken: String(first.output.nextPageToken),
      })
      assert.equal(second.success, true, second.error)
      assert.equal(requests, before + 2)
      assert.equal(second.output.nextPageToken, null)
      assert.equal(toArray(first.output[key]).length, 1)
      assert.equal(toArray(second.output[key]).length, 1)
      assert.notDeepEqual(first.output[key], second.output[key])
    })
  }
  for (const tool of [googleAdsCampaignPerformanceTool, googleAdsAdPerformanceTool]) {
    for (const bounds of [
      { startDate: '' },
      { endDate: '' },
      { startDate: '', endDate: '' },
      { startDate: '2026-10-01' },
      { endDate: '2026-10-08' },
      { startDate: '2026-02-30', endDate: '2026-03-01' },
      { startDate: '2026-10-08', endDate: '2026-10-01' },
    ]) {
      await check(
        `${tool.id} rejects invalid custom bounds ${JSON.stringify(bounds)}`,
        async () => {
          const before = requests
          await assert.rejects(() => invoke(tool, { ...params, ...bounds }), /date|Date/)
          assert.equal(requests, before)
        }
      )
    }
    await check(`${tool.id} preserves 64-bit metrics and fractional conversions`, async () => {
      const result = await invoke(tool, {
        ...params,
        startDate: '2024-02-29',
        endDate: '2024-03-01',
      })
      assert.equal(result.success, true, result.error)
      const rows = toArray(
        'campaigns' in result.output ? result.output.campaigns : result.output.ads
      )
      assert.equal(toRecord(rows[0]).impressions, '9007199254740993')
      assert.equal(toRecord(rows[0]).conversions, 0.5)
    })
  }
  for (const tool of [
    googleAdsListCampaignsTool,
    googleAdsListAdGroupsTool,
    googleAdsAdPerformanceTool,
  ]) {
    await check(`${tool.id} preserves an omitted limit from null input`, async () => {
      const direct = await invoke(tool, { ...params, limit: null })
      assert.equal(direct.success, true, direct.error)
      const mapped = GoogleAdsBlock.tools.config?.params?.({ ...params, limit: null })
      const workflow = await invoke(tool, { ...params, ...mapped })
      assert.equal(workflow.success, true, workflow.error)
    })
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await check(`${tool.id} rejects limit ${String(limit)}`, async () => {
        const before = requests
        await assert.rejects(() => invoke(tool, { ...params, limit }), /limit/i)
        assert.equal(requests, before)
      })
    }
  }
  await check(
    'permission failure remains an error rather than an empty successful report',
    async () => {
      mode = 'denied'
      const result = await invoke(googleAdsListCampaignsTool, params)
      assert.equal(result.success, false)
      assert.match(result.error ?? '', /not accessible/)
    }
  )
  await check('empty reports preserve a zero total and terminal page', async () => {
    mode = 'empty'
    const result = await invoke(googleAdsSearchTool, {
      ...params,
      query: 'SELECT campaign.id FROM campaign',
    })
    assert.equal(result.success, true, result.error)
    assert.deepEqual(result.output, { results: [], totalResultsCount: 0, nextPageToken: null })
  })
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify({ boundary: 'synthetic HTTP, not live Google', requests, checks }, null, 2)
  )
}
const failed = checks.filter((check) => check.status === 'failed')
logger.info('Google Ads validation complete', {
  passed: checks.length - failed.length,
  failed: failed.length,
  reportPath,
})
if (failed.length) process.exitCode = 1
