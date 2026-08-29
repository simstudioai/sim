/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

vi.unmock('@/tools/registry')

import { executeNetsuiteTool } from '@/lib/internal/netsuite/execute-tool'
import { executeNetsuiteAttachRecordOperation } from '@/lib/internal/netsuite/operations/attach-record'
import { executeNetsuiteGetSelectOptionsOperation } from '@/lib/internal/netsuite/operations/get-select-options'
import { executeNetsuiteGetSubresourceOperation } from '@/lib/internal/netsuite/operations/get-subresource'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import { NetSuiteBlock } from '@/blocks/blocks/netsuite'
import type { SubBlockConfig } from '@/blocks/types'
import toolMetadata from '@/tools/generated/tool-metadata'
import * as netsuiteToolExports from '@/tools/netsuite'
import {
  netsuiteAttachRecordTool,
  netsuiteBatchCreateRecordsTool,
  netsuiteBatchDeleteRecordsTool,
  netsuiteBatchGetRecordsTool,
  netsuiteBatchUpdateRecordsTool,
  netsuiteBatchUpsertRecordsTool,
  netsuiteCreateRecordTool,
  netsuiteDeleteRecordTool,
  netsuiteDetachRecordTool,
  netsuiteExecuteActionTool,
  netsuiteExecuteDatasetTool,
  netsuiteExecuteSuiteQLTool,
  netsuiteGetAsyncResultTool,
  netsuiteGetAsyncStatusTool,
  netsuiteGetGovernanceLimitsTool,
  netsuiteGetRecordFormTool,
  netsuiteGetRecordMetadataTool,
  netsuiteGetRecordTool,
  netsuiteGetSelectOptionsTool,
  netsuiteGetServerTimeTool,
  netsuiteGetSubresourceTool,
  netsuiteListDatasetsTool,
  netsuiteListRecordsTool,
  netsuiteListRecordTypesTool,
  netsuiteTransformRecordTool,
  netsuiteUpdateRecordTool,
  netsuiteUpsertRecordTool,
} from '@/tools/netsuite'
import type { NetSuiteAuthParams } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { tools } from '@/tools/registry'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const ORIGIN = 'https://1234567.suitetalk.api.netsuite.com'
const AUTH: NetSuiteAuthParams = {
  oauthCredential: 'credential-id',
  accessToken: 'token',
  instanceUrl: ORIGIN,
}

function invoke<P extends NetSuiteAuthParams>(
  tool: InternalToolConfig<P>,
  params: Omit<P, keyof NetSuiteAuthParams>
): () => Promise<ToolResponse> {
  return async () => {
    const input = tool.operation.input({ ...AUTH, ...params } as P)
    const response = await executeNetsuiteTool({
      toolId: tool.id,
      input,
      headers: new Headers(),
      context: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      requestId: 'request-1',
    })
    return (await response.json()) as ToolResponse
  }
}

const NETSUITE_TOOLS = [
  netsuiteListRecordsTool,
  netsuiteGetRecordTool,
  netsuiteCreateRecordTool,
  netsuiteUpdateRecordTool,
  netsuiteUpsertRecordTool,
  netsuiteDeleteRecordTool,
  netsuiteGetSubresourceTool,
  netsuiteGetRecordFormTool,
  netsuiteGetSelectOptionsTool,
  netsuiteAttachRecordTool,
  netsuiteDetachRecordTool,
  netsuiteExecuteActionTool,
  netsuiteTransformRecordTool,
  netsuiteBatchGetRecordsTool,
  netsuiteBatchCreateRecordsTool,
  netsuiteBatchUpdateRecordsTool,
  netsuiteBatchUpsertRecordsTool,
  netsuiteBatchDeleteRecordsTool,
  netsuiteExecuteSuiteQLTool,
  netsuiteListDatasetsTool,
  netsuiteExecuteDatasetTool,
  netsuiteListRecordTypesTool,
  netsuiteGetRecordMetadataTool,
  netsuiteGetAsyncStatusTool,
  netsuiteGetAsyncResultTool,
  netsuiteGetServerTimeTool,
  netsuiteGetGovernanceLimitsTool,
] as const

function importedNetSuiteTools(): InternalToolConfig[] {
  return Object.values(netsuiteToolExports).filter(
    (value): value is InternalToolConfig =>
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof value.id === 'string' &&
      value.id.startsWith('netsuite_') &&
      'operation' in value
  )
}

function mergedBlockInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const mapParams = NetSuiteBlock.tools.config.params
  if (!mapParams) throw new Error('NetSuite block must map tool parameters')
  return { ...inputs, ...mapParams(inputs) }
}

const netSuiteOperationIds = (
  NetSuiteBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')?.options ?? []
).map((option) => String(option.id))

const netSuiteToolById = new Map(importedNetSuiteTools().map((tool) => [tool.id, tool]))

function paramIdOf(subBlock: SubBlockConfig): string {
  return subBlock.canonicalParamId ?? subBlock.id
}

function conditionOperations(subBlock: SubBlockConfig): string[] {
  const condition = subBlock.condition
  if (!condition || typeof condition === 'function') return netSuiteOperationIds
  const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(String)
  return condition.not
    ? netSuiteOperationIds.filter((operation) => !values.includes(operation))
    : values
}

function requiredOperations(subBlock: SubBlockConfig): string[] {
  const required = subBlock.required
  if (required === true) return netSuiteOperationIds
  if (!required || typeof required !== 'object') return []
  const value = (required as { value: unknown }).value
  return (Array.isArray(value) ? value : [value]).map(String)
}

function blockParamId(toolId: string, toolParamId: string): string {
  if (toolParamId !== 'taskId') return toolParamId
  return toolId === 'netsuite_get_async_status' ? 'statusTaskId' : 'resultTaskId'
}

function toolParamId(toolId: string, blockParamIdValue: string): string {
  if (toolId === 'netsuite_get_async_status' && blockParamIdValue === 'statusTaskId')
    return 'taskId'
  if (toolId === 'netsuite_get_async_result' && blockParamIdValue === 'resultTaskId')
    return 'taskId'
  return blockParamIdValue
}

interface SourceMatrixEntry {
  id: string
  source: string
  additionalSources?: readonly string[]
  method: string
  path: string
  successStatus: number
  execute: () => Promise<ToolResponse>
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
  responseBody?: unknown
  locationPath?: string
}

const LIST_RECORDS_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1540810951.html'
const CREATE_RECORD_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1545141395.html'
const REPLACE_SUBLIST_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1545297048.html'
const GET_RECORD_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1545141500.html'
const UPDATE_RECORD_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1545142173.html'
const UPSERT_RECORD_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156335203191.html'
const DELETE_RECORD_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1545142287.html'
const SUBRESOURCE_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159894563219.html'
const FORM_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1217103046.html'
const SELECT_OPTIONS_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0115100241.html'
const ATTACH_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0113084334.html'
const ACTION_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156631158782.html'
const TRANSFORM_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157901123882.html'
const BATCH_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0127092747.html'
const SUITEQL_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158394344595.html'
const DATASET_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156577938018.html'
const METADATA_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1540810174.html'
const ASYNC_JOB_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_161278579295.html'
const ASYNC_RESULT_SOURCE =
  'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_161252889998.html'

/**
 * Executable Oracle source matrix. This table centralizes the reviewed documentation links and
 * drives the method/path/query/header/body/status tests below. The links are review evidence, not
 * live assertions against Oracle's documentation.
 */
const SOURCE_MATRIX: SourceMatrixEntry[] = [
  {
    id: 'netsuite_list_records',
    source: LIST_RECORDS_SOURCE,
    method: 'GET',
    path: '/services/rest/record/v1/customer',
    query: { limit: '25', offset: '50', q: "email START_WITH 'a'" },
    successStatus: 200,
    responseBody: {
      links: [],
      items: [],
      count: 0,
      hasMore: false,
      offset: 50,
      totalResults: 0,
    },
    execute: invoke(netsuiteListRecordsTool, {
      recordType: 'customer',
      limit: 25,
      offset: 50,
      q: "email START_WITH 'a'",
    }),
  },
  {
    id: 'netsuite_get_record',
    source: GET_RECORD_SOURCE,
    additionalSources: [FORM_SOURCE],
    method: 'GET',
    path: '/services/rest/record/v1/customer/A%2FB',
    query: { expand: 'salesRep', expandSubResources: 'true' },
    successStatus: 200,
    execute: invoke(netsuiteGetRecordTool, {
      recordType: 'customer',
      recordId: 'A/B',
      expand: 'salesRep',
      expandSubResources: true,
    }),
  },
  {
    id: 'netsuite_create_record',
    source: CREATE_RECORD_SOURCE,
    method: 'POST',
    path: '/services/rest/record/v1/customer',
    body: { companyName: 'Acme' },
    successStatus: 204,
    locationPath: '/services/rest/record/v1/customer/647',
    execute: invoke(netsuiteCreateRecordTool, {
      recordType: 'customer',
      body: { companyName: 'Acme' },
    }),
  },
  {
    id: 'netsuite_update_record',
    source: UPDATE_RECORD_SOURCE,
    method: 'PATCH',
    path: '/services/rest/record/v1/customer/7',
    query: { replace: 'addressbook' },
    body: { email: 'billing@example.com' },
    successStatus: 204,
    locationPath: '/services/rest/record/v1/customer/7',
    execute: invoke(netsuiteUpdateRecordTool, {
      recordType: 'customer',
      recordId: '7',
      replace: 'addressbook',
      body: { email: 'billing@example.com' },
    }),
  },
  {
    id: 'netsuite_upsert_record',
    source: UPSERT_RECORD_SOURCE,
    method: 'PUT',
    path: '/services/rest/record/v1/customer/eid:EXT-7',
    body: { companyName: 'Acme' },
    successStatus: 204,
    locationPath: '/services/rest/record/v1/customer/647',
    execute: invoke(netsuiteUpsertRecordTool, {
      recordType: 'customer',
      externalId: 'EXT-7',
      body: { companyName: 'Acme' },
    }),
  },
  {
    id: 'netsuite_delete_record',
    source: DELETE_RECORD_SOURCE,
    method: 'DELETE',
    path: '/services/rest/record/v1/customer/7',
    successStatus: 204,
    execute: invoke(netsuiteDeleteRecordTool, { recordType: 'customer', recordId: '7' }),
  },
  {
    id: 'netsuite_get_subresource',
    source: SUBRESOURCE_SOURCE,
    method: 'GET',
    path: '/services/rest/record/v1/salesOrder/7/item/3',
    successStatus: 200,
    execute: invoke(netsuiteGetSubresourceTool, {
      recordType: 'salesOrder',
      recordId: '7',
      subresourcePath: 'item/3',
    }),
  },
  {
    id: 'netsuite_get_record_form',
    source: FORM_SOURCE,
    method: 'POST',
    path: '/services/rest/record/v1/customer',
    headers: { Accept: 'application/vnd.oracle.resource+json; type=create-form' },
    body: {},
    successStatus: 200,
    execute: invoke(netsuiteGetRecordFormTool, { recordType: 'customer' }),
  },
  {
    id: 'netsuite_get_select_options',
    source: SELECT_OPTIONS_SOURCE,
    method: 'PATCH',
    path: '/services/rest/record/v1/customer/7',
    query: { limit: '25', offset: '50', fields: 'currency,terms', q: 'US START_WITH A' },
    headers: { Accept: 'application/vnd.oracle.resource+json; type=select-options' },
    body: { subsidiary: { id: '1' } },
    successStatus: 200,
    execute: invoke(netsuiteGetSelectOptionsTool, {
      recordType: 'customer',
      recordId: '7',
      fields: 'currency,terms',
      q: 'US START_WITH A',
      limit: 25,
      offset: 50,
      body: { subsidiary: { id: '1' } },
    }),
  },
  {
    id: 'netsuite_attach_record',
    source: ATTACH_SOURCE,
    method: 'POST',
    path: '/services/rest/record/v1/customer/7/!attach/contact/9',
    body: { role: { id: '-10' } },
    successStatus: 204,
    execute: invoke(netsuiteAttachRecordTool, {
      recordType: 'customer',
      recordId: '7',
      relatedType: 'contact',
      relatedId: '9',
      roleId: '-10',
    }),
  },
  {
    id: 'netsuite_detach_record',
    source: ATTACH_SOURCE,
    method: 'POST',
    path: '/services/rest/record/v1/customer/7/!detach/file/9',
    successStatus: 204,
    execute: invoke(netsuiteDetachRecordTool, {
      recordType: 'customer',
      recordId: '7',
      relatedType: 'file',
      relatedId: '9',
    }),
  },
  {
    id: 'netsuite_execute_action',
    source: ACTION_SOURCE,
    method: 'POST',
    path: '/services/rest/record/v1/vendorPayment/3/@confirm',
    body: { postingPeriod: 348 },
    successStatus: 200,
    responseBody: { result: true },
    execute: invoke(netsuiteExecuteActionTool, {
      recordType: 'vendorPayment',
      recordId: '3',
      action: 'confirm',
      body: { postingPeriod: 348 },
    }),
  },
  {
    id: 'netsuite_transform_record',
    source: TRANSFORM_SOURCE,
    method: 'POST',
    path: '/services/rest/record/v1/salesOrder/3/!transform/invoice',
    body: { memo: 'Automated' },
    successStatus: 204,
    locationPath: '/services/rest/record/v1/invoice/912',
    execute: invoke(netsuiteTransformRecordTool, {
      recordType: 'salesOrder',
      recordId: '3',
      targetRecordType: 'invoice',
      body: { memo: 'Automated' },
    }),
  },
  {
    id: 'netsuite_batch_get_records',
    source: BATCH_SOURCE,
    method: 'GET',
    path: '/services/rest/record/v1/customer',
    query: { expandRecords: 'true', ids: '1,eid:EXT-2' },
    headers: { Prefer: 'respond-async', 'X-NetSuite-idempotency-key': 'batch-get' },
    successStatus: 202,
    execute: invoke(netsuiteBatchGetRecordsTool, {
      recordType: 'customer',
      ids: '1,eid:EXT-2',
      idempotencyKey: 'batch-get',
    }),
  },
  {
    id: 'netsuite_batch_create_records',
    source: BATCH_SOURCE,
    method: 'POST',
    path: '/services/rest/record/v1/customer',
    headers: {
      Prefer: 'respond-async',
      'Content-Type': 'application/vnd.oracle.resource+json; type=collection',
    },
    body: { items: [{ companyName: 'Acme' }] },
    successStatus: 202,
    execute: invoke(netsuiteBatchCreateRecordsTool, {
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
    }),
  },
  {
    id: 'netsuite_batch_update_records',
    source: BATCH_SOURCE,
    method: 'PATCH',
    path: '/services/rest/record/v1/customer',
    headers: {
      Prefer: 'respond-async',
      'Content-Type': 'application/vnd.oracle.resource+json; type=collection',
    },
    body: { items: [{ id: '7', email: 'billing@example.com' }] },
    successStatus: 202,
    execute: invoke(netsuiteBatchUpdateRecordsTool, {
      recordType: 'customer',
      items: [{ id: '7', email: 'billing@example.com' }],
    }),
  },
  {
    id: 'netsuite_batch_upsert_records',
    source: BATCH_SOURCE,
    method: 'PUT',
    path: '/services/rest/record/v1/customer',
    headers: {
      Prefer: 'respond-async',
      'Content-Type': 'application/vnd.oracle.resource+json; type=collection',
    },
    body: { items: [{ externalId: 'EXT-7', companyName: 'Acme' }] },
    successStatus: 202,
    execute: invoke(netsuiteBatchUpsertRecordsTool, {
      recordType: 'customer',
      items: [{ externalId: 'EXT-7', companyName: 'Acme' }],
    }),
  },
  {
    id: 'netsuite_batch_delete_records',
    source: BATCH_SOURCE,
    method: 'DELETE',
    path: '/services/rest/record/v1/customer',
    query: { ids: '1,2' },
    headers: { Prefer: 'respond-async' },
    successStatus: 202,
    execute: invoke(netsuiteBatchDeleteRecordsTool, { recordType: 'customer', ids: '1,2' }),
  },
  {
    id: 'netsuite_execute_suiteql',
    source: SUITEQL_SOURCE,
    method: 'POST',
    path: '/services/rest/query/v1/suiteql',
    query: { limit: '100', offset: '0' },
    headers: { Prefer: 'transient' },
    body: { q: 'SELECT id FROM customer ORDER BY id' },
    successStatus: 200,
    responseBody: {
      links: [],
      items: [],
      count: 0,
      hasMore: false,
      offset: 0,
      totalResults: 0,
    },
    execute: invoke(netsuiteExecuteSuiteQLTool, {
      query: 'SELECT id FROM customer ORDER BY id',
    }),
  },
  {
    id: 'netsuite_list_datasets',
    source: DATASET_SOURCE,
    method: 'GET',
    path: '/services/rest/query/v1/dataset/',
    query: { limit: '100', offset: '0' },
    successStatus: 200,
    responseBody: {
      links: [],
      items: [],
      count: 0,
      hasMore: false,
      offset: 0,
      totalResults: 0,
    },
    execute: invoke(netsuiteListDatasetsTool, {}),
  },
  {
    id: 'netsuite_execute_dataset',
    source: DATASET_SOURCE,
    method: 'GET',
    path: '/services/rest/query/v1/dataset/customworkbook237/result',
    query: { limit: '1', offset: '2' },
    successStatus: 200,
    responseBody: {
      links: [],
      items: [],
      count: 0,
      hasMore: false,
      offset: 2,
      totalResults: 0,
    },
    execute: invoke(netsuiteExecuteDatasetTool, {
      datasetId: 'customworkbook237',
      limit: 1,
      offset: 2,
    }),
  },
  {
    id: 'netsuite_list_record_types',
    source: METADATA_SOURCE,
    method: 'GET',
    path: '/services/rest/record/v1/metadata-catalog',
    successStatus: 200,
    responseBody: { items: [{ name: 'customer', links: [] }] },
    execute: invoke(netsuiteListRecordTypesTool, {}),
  },
  {
    id: 'netsuite_get_record_metadata',
    source: METADATA_SOURCE,
    method: 'GET',
    path: '/services/rest/record/v1/metadata-catalog/customer',
    headers: { Accept: 'application/schema+json' },
    successStatus: 200,
    execute: invoke(netsuiteGetRecordMetadataTool, {
      recordType: 'customer',
      format: 'json_schema',
    }),
  },
  {
    id: 'netsuite_get_async_status',
    source: ASYNC_JOB_SOURCE,
    method: 'GET',
    path: '/services/rest/async/v1/job/job%2F7',
    successStatus: 200,
    responseBody: {
      completed: false,
      id: 'job/7',
      progress: 'pending',
      startTime: '2026-08-12T12:00:00Z',
      task: { links: [] },
      links: [],
    },
    execute: invoke(netsuiteGetAsyncStatusTool, {
      jobId: 'job/7',
      view: 'job',
    }),
  },
  {
    id: 'netsuite_get_async_result',
    source: ASYNC_RESULT_SOURCE,
    method: 'GET',
    path: '/services/rest/async/v1/job/job-7/task/task%2F2/result',
    successStatus: 200,
    execute: invoke(netsuiteGetAsyncResultTool, { jobId: 'job-7', taskId: 'task/2' }),
  },
  {
    id: 'netsuite_get_server_time',
    source: 'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0528010158.html',
    method: 'GET',
    path: '/services/rest/system/v1/serverTime',
    successStatus: 200,
    responseBody: { serverTime: '2026-08-12T12:00:00Z' },
    execute: invoke(netsuiteGetServerTimeTool, {}),
  },
  {
    id: 'netsuite_get_governance_limits',
    source: 'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0625010817.html',
    method: 'GET',
    path: '/services/rest/system/v1/governanceLimits',
    successStatus: 200,
    responseBody: {
      accountConcurrencyLimit: 25,
      accountUnallocatedConcurrencyLimit: 15,
      integrationConcurrencyLimit: 10,
      integrationLimitType: 'integrationSpecific',
    },
    execute: invoke(netsuiteGetGovernanceLimitsTool, {}),
  },
]

describe('NetSuite operation contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('matches all 27 Oracle method, path, query, header, body, and success contracts', async () => {
    const apiCalls: Array<{ url: string; init?: RequestInit }> = []
    let apiIndex = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        apiCalls.push({ url, init })
        const entry = SOURCE_MATRIX[apiIndex]
        apiIndex += 1
        const headers = entry.locationPath
          ? { Location: `${ORIGIN}${entry.locationPath}` }
          : entry.successStatus === 202
            ? { Location: `${ORIGIN}/services/rest/async/v1/job/job-${apiIndex}` }
            : undefined
        return entry.successStatus === 204 || entry.successStatus === 202
          ? new Response(null, { status: entry.successStatus, headers })
          : new Response(JSON.stringify(entry.responseBody ?? { operation: entry.id }), {
              status: entry.successStatus,
              headers: { 'Content-Type': 'application/json', ...headers },
            })
      })
    )

    for (const [index, entry] of SOURCE_MATRIX.entries()) {
      const result = await entry.execute()
      expect(result.success, entry.id).toBe(true)
      expect(result.output?.status, entry.id).toBe(entry.successStatus)
      if (entry.successStatus === 204) expect(result.output?.data, entry.id).toBeNull()
      if (entry.responseBody !== undefined) {
        expect(result.output?.data, entry.id).toEqual(entry.responseBody)
      }
      if (entry.locationPath) {
        expect(result.output?.location, entry.id).toBe(`${ORIGIN}${entry.locationPath}`)
      }
      if (entry.successStatus === 202) {
        expect(result.output?.data, entry.id).toBeNull()
        expect(result.output?.location, entry.id).toContain('/services/rest/async/v1/job/')
        expect(result.output?.jobId, entry.id).toBe(`job-${index + 1}`)
      }

      const call = apiCalls[index]
      const expectedUrl = new URL(entry.path, ORIGIN)
      for (const [key, value] of Object.entries(entry.query ?? {})) {
        expectedUrl.searchParams.set(key, value)
      }
      expect(call.url, `${entry.id} raw URL`).toBe(expectedUrl.toString())
      expect(call.init?.method, entry.id).toBe(entry.method)
      expect(call.init?.redirect, entry.id).toBe('error')
      const expectedHeaders: Record<string, string> = {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        ...entry.headers,
      }
      if (entry.body !== undefined && !expectedHeaders['Content-Type']) {
        expectedHeaders['Content-Type'] = 'application/json'
      }
      if (entry.body !== undefined && entry.path.startsWith('/services/rest/record/')) {
        expectedHeaders['X-NetSuite-PropertyNameValidation'] = 'error'
      }
      expect(
        Object.fromEntries(new Headers(call.init?.headers).entries()),
        `${entry.id} exact headers`
      ).toEqual(Object.fromEntries(new Headers(expectedHeaders).entries()))
      expect(entry.source, entry.id).toMatch(
        /^https:\/\/docs\.oracle\.com\/en\/cloud\/saas\/netsuite\//
      )
      for (const source of entry.additionalSources ?? []) {
        expect(source, entry.id).toMatch(
          /^https:\/\/docs\.oracle\.com\/en\/cloud\/saas\/netsuite\//
        )
      }
      if (entry.body !== undefined) {
        expect(call.init?.body, `${entry.id} serialized body`).toBe(JSON.stringify(entry.body))
      } else {
        expect(call.init?.body, `${entry.id} body`).toBeUndefined()
      }
    }

    expect(apiCalls).toHaveLength(27)
  })

  it("enforces Oracle's conditional create response contracts in both directions", async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        calls.push(input instanceof Request ? input.url : input.toString())
        if (calls.length === 1) {
          return new Response(JSON.stringify({ id: '647', companyName: 'Acme' }), {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
              Location: `${ORIGIN}/services/rest/record/v1/customer/647`,
            },
          })
        }
        if (calls.length === 2) {
          return new Response(null, {
            status: 204,
            headers: { Location: `${ORIGIN}/services/rest/record/v1/customer/648` },
          })
        }
        return new Response(JSON.stringify({ id: '649', companyName: 'Acme' }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            Location: `${ORIGIN}/services/rest/record/v1/customer/649`,
          },
        })
      })
    )

    const executeReplacement = invoke(netsuiteCreateRecordTool, {
      recordType: 'customer',
      body: { companyName: 'Acme' },
      replace: 'addressbook',
    })
    const created = await executeReplacement()
    const undocumented = await executeReplacement()
    const undocumentedStandard = await invoke(netsuiteCreateRecordTool, {
      recordType: 'customer',
      body: { companyName: 'Acme' },
    })()

    expect(created).toMatchObject({
      success: true,
      output: {
        status: 201,
        data: { id: '647', companyName: 'Acme' },
        location: `${ORIGIN}/services/rest/record/v1/customer/647`,
      },
    })
    expect(new URL(calls[0]).searchParams.get('replace')).toBe('addressbook')
    expect(undocumented.success).toBe(false)
    expect(undocumented.error).toContain('HTTP 204')
    expect(new URL(calls[2]).searchParams.has('replace')).toBe(false)
    expect(undocumentedStandard.success).toBe(false)
    expect(undocumentedStandard.error).toContain('HTTP 201')
    expect(REPLACE_SUBLIST_SOURCE).toMatch(
      /^https:\/\/docs\.oracle\.com\/en\/cloud\/saas\/netsuite\//
    )
  })

  it('accepts a SuiteQL page without hasMore but still requires it on record collections', async () => {
    // Oracle's SuiteQL reference lists links, count, offset, totalResults, and
    // items — but not hasMore — while record collections document all six.
    const suiteqlPage = { links: [], items: [], count: 0, offset: 0, totalResults: 0 }
    const responses = [
      new Response(JSON.stringify(suiteqlPage), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({ ...suiteqlPage, hasMore: 'nope' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify(suiteqlPage), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift() ?? new Response('{}'))
    )

    const suiteql = await invoke(netsuiteExecuteSuiteQLTool, { query: 'SELECT id FROM customer' })()
    const badHasMore = await invoke(netsuiteExecuteSuiteQLTool, {
      query: 'SELECT id FROM customer',
    })()
    const records = await invoke(netsuiteListRecordsTool, { recordType: 'customer' })()

    expect(suiteql.success).toBe(true)
    expect(badHasMore.success).toBe(false)
    expect(badHasMore.error).toContain('hasMore')
    expect(records.success).toBe(false)
    expect(records.error).toContain('hasMore')
  })

  it('treats the upsert and transform Location header as optional', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    )

    const upserted = await invoke(netsuiteUpsertRecordTool, {
      recordType: 'customer',
      externalId: 'EXT-7',
      body: { companyName: 'Acme' },
    })()
    const transformed = await invoke(netsuiteTransformRecordTool, {
      recordType: 'salesOrder',
      recordId: '3',
      targetRecordType: 'invoice',
      body: { memo: 'Automated' },
    })()

    // Oracle documents the Location header for create and update but not for
    // upsert or transform, so a response without it must still succeed.
    for (const result of [upserted, transformed]) {
      expect(result.success).toBe(true)
      expect(result.output?.status).toBe(204)
      expect(result.output?.location).toBeUndefined()
    }
  })

  it('validates required metadata items and optional catalog and record-type links', async () => {
    const cases = [
      { body: { items: [{ name: 'customer' }] }, success: true },
      {
        body: { links: [], items: [{ name: 'customer', links: [] }] },
        success: true,
      },
      { body: {}, success: false },
      { body: { items: [{ name: '   ' }] }, success: false },
      { body: { links: {}, items: [{ name: 'customer' }] }, success: false },
      { body: { items: [{ name: 'customer', links: {} }] }, success: false },
    ]

    for (const testCase of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify(testCase.body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
        )
      )
      const result = await invoke(netsuiteListRecordTypesTool, {})()
      expect(result.success, JSON.stringify(testCase.body)).toBe(testCase.success)
      if (!testCase.success) expect(result.error).toContain('metadata catalog')
    }
  })

  it('derives one 27-operation surface across block, barrel, registry, matrix, and generated data', () => {
    const dropdownIds = (
      NetSuiteBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')?.options ?? []
    ).map((option) => String(option.id))
    const matrixIds = SOURCE_MATRIX.map((entry) => entry.id)
    const explicitlyImportedIds = NETSUITE_TOOLS.map((tool) => tool.id)
    const barrelIds = importedNetSuiteTools().map((tool) => tool.id)

    expect(matrixIds).toHaveLength(27)
    expect(dropdownIds).toEqual(matrixIds)
    expect(NetSuiteBlock.tools.access).toEqual(matrixIds)
    expect(explicitlyImportedIds).toEqual(matrixIds)
    expect([...barrelIds].sort()).toEqual([...matrixIds].sort())

    for (const id of matrixIds) {
      expect(NetSuiteBlock.tools.config.tool({ operation: id }), `${id} mapping`).toBe(id)
      expect(tools[id]?.id, `${id} registry`).toBe(id)
      expect(toolMetadata[id]?.id, `${id} generated metadata`).toBe(id)
    }
  })

  it('keeps visible, required, and typed block inputs aligned with every selected tool', () => {
    const problems: string[] = []
    const inputs = NetSuiteBlock.inputs as Record<string, { type?: string }>

    for (const tool of NETSUITE_TOOLS) {
      for (const [toolParam, config] of Object.entries(tool.params)) {
        if (config.visibility === 'hidden') continue
        const blockParam = blockParamId(tool.id, toolParam)
        const input = inputs[blockParam]
        if (!input) {
          problems.push(`${tool.id}.${toolParam}: no block input ${blockParam}`)
          continue
        }
        if (input.type !== config.type) {
          problems.push(`${tool.id}.${toolParam}: block type ${input.type} != ${config.type}`)
        }
        const shown = NetSuiteBlock.subBlocks.filter(
          (subBlock) =>
            paramIdOf(subBlock) === blockParam && conditionOperations(subBlock).includes(tool.id)
        )
        if (!shown.length) problems.push(`${tool.id}.${toolParam}: not visible`)
        if (
          config.required &&
          !shown.some((subBlock) => requiredOperations(subBlock).includes(tool.id))
        ) {
          problems.push(`${tool.id}.${toolParam}: not required`)
        }
      }
    }

    for (const subBlock of NetSuiteBlock.subBlocks) {
      if (subBlock.id === 'operation') continue
      for (const operation of conditionOperations(subBlock)) {
        const tool = netSuiteToolById.get(operation)
        if (!tool) {
          problems.push(`${subBlock.id}: unknown operation ${operation}`)
          continue
        }
        const toolParam = toolParamId(operation, paramIdOf(subBlock))
        if (!(toolParam in tool.params)) {
          problems.push(`${subBlock.id}: ${operation} does not accept ${toolParam}`)
        }
      }
    }

    expect(problems).toEqual([])
    expect(
      NETSUITE_TOOLS.filter((tool) => Object.hasOwn(tool.params, 'replace')).map((tool) => tool.id)
    ).toEqual(['netsuite_create_record', 'netsuite_update_record'])
  })

  it('keeps only the approved canonical selector/manual pairs well formed', () => {
    const ids = NetSuiteBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size, 'duplicate sub-block id').toBe(ids.length)
    for (const subBlock of NetSuiteBlock.subBlocks) {
      if (!subBlock.canonicalParamId) continue
      expect(ids, `${subBlock.id} canonical id collides with a sub-block id`).not.toContain(
        subBlock.canonicalParamId
      )
    }

    const groups = buildCanonicalIndex(NetSuiteBlock.subBlocks).groupsById
    for (const [canonicalId, group] of Object.entries(groups)) {
      expect(group.basicId, `${canonicalId} has no basic member`).toBeTruthy()
      expect(group.advancedIds, `${canonicalId} advanced members`).toHaveLength(1)
      const members = NetSuiteBlock.subBlocks.filter(
        (subBlock) => subBlock.canonicalParamId === canonicalId
      )
      expect(
        new Set(members.map((member) => JSON.stringify(member.condition ?? null))).size,
        `${canonicalId} members disagree on condition`
      ).toBe(1)
      expect(
        new Set(members.map((member) => JSON.stringify(member.required ?? null))).size,
        `${canonicalId} members disagree on required`
      ).toBe(1)
    }
    expect(Object.keys(groups).sort()).toEqual([
      'oauthCredential',
      'recordType',
      'resultTaskId',
      'statusTaskId',
    ])
  })

  it('conditions Location and jobId outputs on their producing operations', () => {
    const batchIds = [
      'netsuite_batch_get_records',
      'netsuite_batch_create_records',
      'netsuite_batch_update_records',
      'netsuite_batch_upsert_records',
      'netsuite_batch_delete_records',
    ]
    expect(NetSuiteBlock.outputs.location.condition).toEqual({
      field: 'operation',
      value: [
        'netsuite_create_record',
        'netsuite_update_record',
        'netsuite_upsert_record',
        'netsuite_transform_record',
        ...batchIds,
      ],
    })
    expect(NetSuiteBlock.outputs.jobId.condition).toEqual({
      field: 'operation',
      value: batchIds,
    })
  })

  it('preserves typed agent parameters when no editor operation is present', () => {
    const agentParams = {
      oauthCredential: 'credential-id',
      recordType: 'customer',
      body: { companyName: 'Acme' },
      limit: 25,
      expandSubResources: true,
    }
    expect(mergedBlockInputs(agentParams)).toMatchObject(agentParams)
  })

  it('clears stale workflow expand fields before get-select-options reaches SuiteTalk', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        calls.push(input instanceof Request ? input.url : input.toString())
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    const mapped = mergedBlockInputs({
      ...AUTH,
      operation: 'netsuite_get_select_options',
      recordType: 'customer',
      fields: 'currency,terms',
      expand: 'STALE_RESOURCE',
      expandSubResources: true,
    })
    expect(mapped.expand).toBeUndefined()
    expect(mapped.expandSubResources).toBeUndefined()
    const execute = executeNetsuiteGetSelectOptionsOperation
    if (!execute) throw new Error('NetSuite select-options tool is missing direct execution')
    const result = await execute(mapped as never)
    expect(result.success).toBe(true)
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0])
    expect(url.searchParams.has('expand')).toBe(false)
    expect(url.searchParams.has('expandSubResources')).toBe(false)
  })

  it('shares one resolved-credential contract and keeps replacement controls user-only', () => {
    type RawCredentialParam = Extract<
      keyof NetSuiteAuthParams,
      'suiteTalkUrl' | 'clientId' | 'certificateId' | 'privateKey'
    >
    expectTypeOf<RawCredentialParam>().toEqualTypeOf<never>()
    expectTypeOf<NetSuiteAuthParams>().toMatchTypeOf<{
      oauthCredential: string
      accessToken?: string
      instanceUrl?: string
    }>()

    expect(NETSUITE_TOOLS.map((tool) => tool.id)).toEqual(SOURCE_MATRIX.map((entry) => entry.id))
    for (const tool of NETSUITE_TOOLS) {
      for (const [field, definition] of Object.entries(netsuiteAuthParamFields)) {
        expect(tool.params[field], `${tool.id}.${field}`).toEqual(definition)
      }
      for (const rawCredentialField of [
        'suiteTalkUrl',
        'clientId',
        'certificateId',
        'privateKey',
      ]) {
        expect(tool.params, `${tool.id}.${rawCredentialField}`).not.toHaveProperty(
          rawCredentialField
        )
      }
      for (const [field, definition] of Object.entries(tool.params)) {
        if (field === 'replace') {
          expect(definition.visibility, `${tool.id}.${field}`).toBe('user-only')
        } else if (!Object.hasOwn(netsuiteAuthParamFields, field)) {
          expect(definition.visibility, `${tool.id}.${field}`).toBe('user-or-llm')
        }
      }
    }
  })

  it('keeps retired signing material out of generated action contracts', () => {
    const generated = toolMetadata as Record<
      string,
      { params?: Record<string, { visibility?: string }> }
    >
    for (const tool of NETSUITE_TOOLS) {
      const params = generated[tool.id]?.params
      expect(params, tool.id).toBeDefined()
      expect(params?.oauthCredential, `${tool.id}.oauthCredential`).toMatchObject({
        visibility: 'user-only',
      })
      expect(params?.accessToken, `${tool.id}.accessToken`).toMatchObject({ visibility: 'hidden' })
      expect(params?.instanceUrl, `${tool.id}.instanceUrl`).toMatchObject({ visibility: 'hidden' })
      for (const retiredField of ['suiteTalkUrl', 'clientId', 'certificateId', 'privateKey']) {
        expect(params, `${tool.id}.${retiredField}`).not.toHaveProperty(retiredField)
      }
    }

    const docs = readFileSync(
      resolve(import.meta.dirname, '../../../../apps/docs/content/docs/integrations/netsuite.mdx'),
      'utf8'
    )
    const actions = docs.split('\n## Actions\n', 2)[1]
    expect(actions).toBeDefined()
    for (const retiredField of ['suiteTalkUrl', 'clientId', 'certificateId', 'privateKey']) {
      expect(actions).not.toContain(`| \`${retiredField}\``)
    }
  })

  it('declares batch record collections as arrays of account-specific objects', () => {
    for (const tool of [
      netsuiteBatchCreateRecordsTool,
      netsuiteBatchUpdateRecordsTool,
      netsuiteBatchUpsertRecordsTool,
    ]) {
      expect(tool.params.items, tool.id).toMatchObject({
        type: 'array',
        required: true,
        visibility: 'user-or-llm',
        items: { type: 'object', additionalProperties: true },
      })
    }
  })

  it('exposes Location and async job outputs only for documented operations', () => {
    const batchToolIds = new Set([
      'netsuite_batch_get_records',
      'netsuite_batch_create_records',
      'netsuite_batch_update_records',
      'netsuite_batch_upsert_records',
      'netsuite_batch_delete_records',
    ])

    for (const tool of NETSUITE_TOOLS) {
      const expected = ['status', 'data']
      if (
        tool.id === 'netsuite_create_record' ||
        tool.id === 'netsuite_update_record' ||
        tool.id === 'netsuite_upsert_record' ||
        tool.id === 'netsuite_transform_record' ||
        batchToolIds.has(tool.id)
      ) {
        expected.push('location')
      }
      if (batchToolIds.has(tool.id)) expected.push('jobId')
      expect(Object.keys(tool.outputs ?? {}), tool.id).toEqual(expected)
    }
  })

  it('covers create and existing-record variants for form and select-options media types', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        calls.push({ url, init })
        return new Response('{}', { status: 200 })
      })
    )

    await invoke(netsuiteGetRecordFormTool, { recordType: 'customer', recordId: '7' })()
    await invoke(netsuiteGetSelectOptionsTool, { recordType: 'customer', fields: 'currency' })()

    expect(calls[0].init?.method).toBe('PATCH')
    expect(new URL(calls[0].url).pathname.endsWith('/customer/7')).toBe(true)
    expect(new Headers(calls[0].init?.headers).get('accept')).toBe(
      'application/vnd.oracle.resource+json; type=edit-form'
    )
    expect(calls[1].init?.method).toBe('POST')
    expect(new URL(calls[1].url).pathname.endsWith('/customer')).toBe(true)
    expect(new Headers(calls[1].init?.headers).get('accept')).toBe(
      'application/vnd.oracle.resource+json; type=select-options'
    )
  })

  it('fails closed on malformed documented success envelopes', async () => {
    const responses = [
      new Response(JSON.stringify({ result: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift() ?? new Response('{}'))
    )

    const action = await invoke(netsuiteExecuteActionTool, {
      recordType: 'salesOrder',
      recordId: '7',
      action: 'approve',
    })()
    const collection = await invoke(netsuiteListRecordsTool, { recordType: 'customer' })()

    expect(action.success).toBe(false)
    expect(action.error).toContain('result: true')
    expect(collection.success).toBe(false)
    expect(collection.error).toContain('collection page')
  })

  it('documents stable collection and action response envelopes without guessing record fields', () => {
    for (const tool of [
      netsuiteListRecordsTool,
      netsuiteExecuteSuiteQLTool,
      netsuiteListDatasetsTool,
      netsuiteExecuteDatasetTool,
    ]) {
      const data = tool.outputs?.data
      expect(data?.properties, tool.id).toMatchObject({
        links: { type: 'array' },
        items: { type: 'array' },
        count: { type: 'number' },
        hasMore: { type: 'boolean' },
        offset: { type: 'number' },
        totalResults: { type: 'number' },
      })
    }
    expect(netsuiteExecuteActionTool.outputs?.data?.properties).toEqual({
      result: { type: 'boolean', description: expect.stringContaining('True') },
    })
    expect(netsuiteListRecordsTool.outputs?.data?.properties?.items).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          links: { type: 'array' },
        },
      },
    })
    expect(netsuiteListRecordTypesTool.outputs?.data?.properties).toMatchObject({
      links: { type: 'array' },
      items: {
        type: 'array',
        items: {
          properties: {
            name: { type: 'string' },
            links: {
              type: 'array',
              items: {
                properties: { mediaType: { type: 'string' } },
              },
            },
          },
        },
      },
    })
    expect(netsuiteGetSelectOptionsTool.outputs?.data).toMatchObject({
      type: 'json',
      description: expect.stringContaining('_selectOptions'),
      properties: {
        links: { type: 'array' },
      },
    })
    for (const pagingField of ['items', 'count', 'offset', 'hasMore', 'totalResults']) {
      expect(netsuiteGetSelectOptionsTool.outputs?.data?.description).toContain(pagingField)
    }
  })

  it('retrieves job status by default, lists tasks, and requires a task ID for task status', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString()
        calls.push(url)
        if (url.endsWith('/task')) {
          return new Response(JSON.stringify({ count: 1, items: [], links: [] }))
        }
        return new Response(
          JSON.stringify({
            completed: false,
            id: 'job-7',
            progress: 'pending',
            task: {},
            links: [],
          })
        )
      })
    )

    const job = await invoke(netsuiteGetAsyncStatusTool, {
      jobId: 'job-7',
    })()
    const tasks = await invoke(netsuiteGetAsyncStatusTool, {
      jobId: 'job-7',
      view: 'tasks',
    })()

    expect(job.success).toBe(true)
    expect(tasks.success).toBe(true)
    expect(new URL(calls[0]).pathname).toBe('/services/rest/async/v1/job/job-7')
    expect(new URL(calls[1]).pathname).toBe('/services/rest/async/v1/job/job-7/task')

    const invalid = await invoke(netsuiteGetAsyncStatusTool, {
      jobId: 'job-7',
      view: 'task',
    })()
    expect(invalid.success).toBe(false)
    expect(invalid.error).toContain('Task ID is required')
    expect(calls).toHaveLength(2)
  })

  it('declares only Oracle-documented async task status fields', () => {
    const data = netsuiteGetAsyncStatusTool.outputs?.data
    expect(data?.type).toBe('json')
    if (!data || data.type !== 'json') throw new Error('Missing async status data output')
    expect(data.properties).toMatchObject({
      completed: { type: 'boolean' },
      endTime: { type: 'string' },
      id: { type: 'string' },
      progress: { type: 'string' },
      startTime: { type: 'string' },
      items: {
        type: 'array',
        items: {
          properties: {
            links: {
              type: 'array',
              items: {
                properties: {
                  rel: { type: 'string' },
                  href: { type: 'string' },
                },
              },
            },
          },
        },
      },
      links: {
        type: 'array',
        items: {
          properties: {
            rel: { type: 'string' },
            href: { type: 'string' },
          },
        },
      },
      task: {
        type: 'object',
        properties: {
          links: { type: 'array' },
        },
      },
    })
  })

  it('rejects unsupported external-ID characters before authentication', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await invoke(netsuiteUpsertRecordTool, {
      recordType: 'customer',
      externalId: 'EXT/7',
      body: { companyName: 'Acme' },
    })()

    expect(result.success).toBe(false)
    expect(result.error).toContain('external ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects dot path segments before authentication or SuiteTalk traffic', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const execute = executeNetsuiteGetSubresourceOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      recordId: '7',
      subresourcePath: '../query/v1/suiteql',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('dot path segment')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported relationship targets before sending SuiteTalk traffic', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const execute = executeNetsuiteAttachRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      recordId: '7',
      relatedType: 'vendor' as 'contact',
      relatedId: '9',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('contact or file')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('supports contact role external IDs and rejects ambiguous role references', async () => {
    const apiCalls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        apiCalls.push({ url, init })
        return new Response(null, { status: 204 })
      })
    )

    const result = await invoke(netsuiteAttachRecordTool, {
      recordType: 'customer',
      recordId: '7',
      relatedType: 'contact',
      relatedId: '9',
      roleExternalId: 'family',
    })()
    expect(result.success).toBe(true)
    expect(JSON.parse(String(apiCalls[0].init?.body))).toEqual({
      role: { externalId: 'family' },
    })

    const ambiguous = await invoke(netsuiteAttachRecordTool, {
      recordType: 'customer',
      recordId: '7',
      relatedType: 'contact',
      relatedId: '9',
      roleId: '-10',
      roleExternalId: 'family',
    })()
    expect(ambiguous.success).toBe(false)
    expect(ambiguous.error).toContain('either a contact role ID or external ID')
    expect(apiCalls).toHaveLength(1)

    const file = await invoke(netsuiteAttachRecordTool, {
      recordType: 'opportunity',
      recordId: '379',
      relatedType: 'file',
      relatedId: '398',
    })()
    expect(file.success).toBe(true)
    expect(JSON.parse(String(apiCalls[1].init?.body))).toEqual({})

    const fileWithRole = await invoke(netsuiteAttachRecordTool, {
      recordType: 'opportunity',
      recordId: '379',
      relatedType: 'file',
      relatedId: '398',
      roleId: '-10',
    })()
    expect(fileWithRole.success).toBe(false)
    expect(fileWithRole.error).toContain('Contact roles cannot be provided when attaching a file')
    expect(apiCalls).toHaveLength(2)
  })
})
