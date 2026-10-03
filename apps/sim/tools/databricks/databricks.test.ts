import { inputValidationMock } from '@sim/testing'
import { partialToolRegistry } from '@sim/testing/mocks/tool-registry.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import * as databricksTools from '@/tools/databricks'
import { executeTool } from '@/tools/index'
import { tools } from '@/tools/registry'

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
    expect(urlBuilder('databricks_list_clusters')(params)).toBe(`${origin}/api/2.0/clusters/list`)
    expect(urlBuilder('databricks_execute_sql')(params)).toBe(`${origin}/api/2.0/sql/statements/`)
    expect(urlBuilder('databricks_get_job')(params)).toBe(`${origin}/api/2.1/jobs/get?job_id=1`)
    expect(urlBuilder('databricks_get_run_output')(params)).toBe(
      `${origin}/api/2.1/jobs/runs/get-output?run_id=2`
    )
    expect(urlBuilder('databricks_genie_get_message')(params)).toBe(
      `${origin}/api/2.0/genie/spaces/space1/conversations/conv1/messages/msg1`
    )
  })

  it.each([
    ['dbc-a1b2.cloud.databricks.com.', 'https://dbc-a1b2.cloud.databricks.com'],
    ['https://dbc-a1b2.cloud.databricks.com.:8443/', 'https://dbc-a1b2.cloud.databricks.com:8443'],
  ])(
    'drops the trailing FQDN dot of %s, which the old tools kept and Bun TLS rejects',
    (host, origin) => {
      expect(urlBuilder('databricks_list_clusters')({ ...REQUEST_PARAMS, host })).toBe(
        `${origin}/api/2.0/clusters/list`
      )
    }
  )
})
