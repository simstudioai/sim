import { inputValidationMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { partialToolRegistry } from '@sim/testing/mocks/tool-registry.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { describe, expect, it, vi } from 'vitest'
import { adoptToolFailure, classifyFailure } from '@/lib/core/errors/failure-log'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import * as databricksTools from '@/tools/databricks'
import { executeSqlTool } from '@/tools/databricks/execute_sql'
import { getRunTool } from '@/tools/databricks/get_run'
import { executeTool } from '@/tools/index'
import { tools } from '@/tools/registry'
import { prepareToolRequest } from '@/tools/request-transport'

/** Registers only this service's configs in the global registry mock; the full one is ~6,000 modules. */
Object.assign(tools, partialToolRegistry(databricksTools))

type ToolParams = Record<string, unknown>

function urlBuilder(toolId: string): (params: ToolParams) => string {
  const url = tools[toolId].request.url
  if (typeof url !== 'function') throw new Error(`${toolId} has a static url`)
  return url as (params: ToolParams) => string
}

/** Every identifier any Databricks tool reads while building its URL. */
const REQUEST_PARAMS = {
  apiKey: 'dapi-test-token',
  spaceId: 'space1',
  conversationId: 'conv1',
  messageId: 'msg1',
  attachmentId: 'att1',
  statementId: 'stmt1',
  chunkIndex: 0,
  responseId: 'response1',
  clusterId: 'cluster1',
  jobId: 1,
  runId: 2,
  warehouseId: 'wh1',
  content: 'question',
  sql: 'SELECT 1',
  rating: 'POSITIVE',
}

/** The validator's refusal, naming the `host` param and every allowlisted Databricks domain. */
const HOST_ALLOWLIST_ERROR =
  'host must be a Databricks-hosted domain (e.g., *.cloud.databricks.com, *.cloud.databricks.us, *.cloud.databricks.mil, *.gcp.databricks.com, *.databricks.com, *.azuredatabricks.net, *.databricks.azure.us, *.databricks.azure.cn)'

const DATABRICKS_TOOL_IDS = Object.keys(tools).filter((id) => id.startsWith('databricks_'))

describe('Databricks mutation intent', () => {
  const credentials = { host: 'dbc-test.cloud.databricks.com', apiKey: 'test-token' }

  it('distinguishes clearing a Genie description from leaving it unchanged', () => {
    const update = (description?: string) =>
      JSON.parse(
        prepareToolRequest(databricksTools.databricksGenieUpdateSpaceTool, {
          ...credentials,
          spaceId: 'space1',
          description,
        }).body ?? '{}'
      )

    expect(update('')).toEqual({ description: '' })
    expect(update()).not.toHaveProperty('description')
    expect(update(' \n\t ')).not.toHaveProperty('description')
  })

  it.each([undefined, false])(
    'rejects cancellation without a job or explicit queued scope (%s)',
    async (allQueuedRuns) => {
      const result = await executeTool('databricks_cancel_all_runs', {
        ...credentials,
        allQueuedRuns,
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Provide jobId or set allQueuedRuns to true')
      expect(classifyFailure(adoptToolFailure(new Error(result.error), result))).toBe('user')
    }
  )

  it.each([
    [{ jobId: 42 }, { job_id: 42 }],
    [{ allQueuedRuns: true }, { all_queued_runs: true }],
    [
      { jobId: 42, allQueuedRuns: true },
      { job_id: 42, all_queued_runs: true },
    ],
  ])('retains an explicit cancellation scope %j', (scope, body) => {
    const request = prepareToolRequest(databricksTools.databricksCancelAllRunsTool, {
      ...credentials,
      ...scope,
    })
    expect(JSON.parse(request.body ?? '{}')).toEqual(body)
  })
})

describe('databricks workspace host allowlist', () => {
  it.each([
    'attacker.example.com',
    'https://attacker.example.com/',
    'dbc-1.cloud.databricks.com.attacker.example.com',
    'attacker.example.com/dbc-1.cloud.databricks.com',
    'dbc-1.cloud.databricks.com@attacker.example.com',
    'databricks.com',
    'acme-databricks.com',
  ])('refuses %s in every tool with the host allowlist error', (host) => {
    const notRefusedByAllowlist = DATABRICKS_TOOL_IDS.map((id) => {
      try {
        return `${id}: built ${urlBuilder(id)({ ...REQUEST_PARAMS, host })}`
      } catch (error) {
        return `${id}: ${getErrorMessage(error)}`
      }
    }).filter((outcome) => !outcome.endsWith(`: ${HOST_ALLOWLIST_ERROR}`))
    expect(notRefusedByAllowlist).toEqual([])
  })

  it('fails the tool call for a foreign host with the allowlist error', async () => {
    const result = await executeTool('databricks_list_clusters', {
      host: 'attacker.example.com',
      apiKey: 'dapi-test-token',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain(HOST_ALLOWLIST_ERROR)
  })

  it.each([
    ['dbc-a1b2.cloud.databricks.com', 'https://dbc-a1b2.cloud.databricks.com'],
    ['  https://dbc-a1b2.cloud.databricks.com/  ', 'https://dbc-a1b2.cloud.databricks.com'],
    ['http://dbc-a1b2.cloud.databricks.com', 'https://dbc-a1b2.cloud.databricks.com'],
    ['adb-123.4.azuredatabricks.net', 'https://adb-123.4.azuredatabricks.net'],
    ['https://123.4.gcp.databricks.com/', 'https://123.4.gcp.databricks.com'],
    ['dbc-a1b2.cloud.databricks.us', 'https://dbc-a1b2.cloud.databricks.us'],
    ['adb-123.4.databricks.azure.us', 'https://adb-123.4.databricks.azure.us'],
    ['adb-123.4.databricks.azure.cn', 'https://adb-123.4.databricks.azure.cn'],
    ['dbc-a1b2.cloud.databricks.mil', 'https://dbc-a1b2.cloud.databricks.mil'],
    ['https://acme.databricks.com/', 'https://acme.databricks.com'],
  ])('builds the same request URLs for workspace host %s', (host, origin) => {
    const params = { ...REQUEST_PARAMS, host }
    for (const toolId of DATABRICKS_TOOL_IDS) {
      expect(new URL(urlBuilder(toolId)(params)).origin).toBe(origin)
    }
  })

  it.each([
    ['dbc-a1b2.cloud.databricks.com.', 'https://dbc-a1b2.cloud.databricks.com'],
    ['https://dbc-a1b2.cloud.databricks.com.:8443/', 'https://dbc-a1b2.cloud.databricks.com:8443'],
  ])(
    'drops the trailing FQDN dot of %s, which the old tools kept and Bun TLS rejects',
    (host, origin) => {
      expect(
        new URL(urlBuilder('databricks_list_clusters')({ ...REQUEST_PARAMS, host })).origin
      ).toBe(origin)
    }
  )
})

describe('Databricks paginated results', () => {
  it('keeps SQL null values and the cursor needed to retrieve rows beyond the first chunk', async () => {
    const result = await executeSqlTool.transformResponse?.(
      jsonResponse({
        statement_id: 'statement-1',
        status: { state: 'SUCCEEDED' },
        manifest: { total_row_count: 3, total_chunk_count: 2, truncated: false },
        result: {
          data_array: [['first', null]],
          chunk_index: 0,
          row_count: 1,
          row_offset: 0,
          next_chunk_index: 1,
        },
      })
    )

    expect(result?.output).toMatchObject({
      data: [['first', null]],
      totalRows: 3,
      chunkIndex: 0,
      rowCount: 1,
      rowOffset: 0,
      nextChunkIndex: 1,
      totalChunks: 2,
    })
  })

  it('preserves task run IDs and repair history so a multi-task run can be inspected and repaired', async () => {
    const result = await getRunTool.transformResponse?.(
      jsonResponse({
        run_id: 10,
        tasks: [
          {
            task_key: 'extract',
            run_id: 11,
            state: { result_state: 'FAILED' },
            resolved_values: { notebook_task: { base_parameters: { date: '2026-01-01' } } },
          },
        ],
        repair_history: [{ id: 12, type: 'REPAIR', task_run_ids: [11] }],
        next_page_token: 'next-tasks',
      })
    )

    expect(result?.output).toMatchObject({
      tasks: [
        {
          task_key: 'extract',
          run_id: 11,
          resolved_values: { notebook_task: { base_parameters: { date: '2026-01-01' } } },
        },
      ],
      repairHistory: [{ id: 12, type: 'REPAIR', task_run_ids: [11] }],
      nextPageToken: 'next-tasks',
    })
  })
})
