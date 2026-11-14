/**
 * The executor hands a tool `{ ...rawInputs, ...blockParams }`, and an advanced subBlock with a
 * stored value serializes whatever operation is selected. These cases keep values stored for one
 * Hex operation out of another operation's request.
 */
import { describe, expect, it } from 'vitest'
import { HexBlock } from '@/blocks/blocks/hex'
import type { BlockToolParamsContext } from '@/blocks/types'
import { getProjectRunsTool } from '@/tools/hex/get_project_runs'
import { getQueriedTablesTool } from '@/tools/hex/get_queried_tables'
import { listGroupsTool } from '@/tools/hex/list_groups'
import { listUsersTool } from '@/tools/hex/list_users'
import type { ToolConfig } from '@/tools/types'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

function requestUrl(
  tool: ToolConfig,
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): URL {
  const mapped = HexBlock.tools.config?.params?.(inputs, context) ?? {}
  const params = { apiKey: 'hex-token', ...inputs, ...mapped }
  const url = tool.request.url
  return new URL(typeof url === 'function' ? url(params) : url)
}

describe('Hex block keeps stale subBlock values out of tool requests', () => {
  it('get project runs ignores the List Projects status filter', () => {
    const url = requestUrl(getProjectRunsTool, {
      operation: 'get_project_runs',
      projectId: PROJECT_ID,
      statusFilter: 'PUBLISHED',
    })
    expect(url.searchParams.has('statusFilter')).toBe(false)
  })

  it('get project runs still sends its own status filter', () => {
    const url = requestUrl(getProjectRunsTool, {
      operation: 'get_project_runs',
      projectId: PROJECT_ID,
      statusFilter: 'PUBLISHED',
      runStatusFilter: 'ERRORED',
    })
    expect(url.searchParams.get('statusFilter')).toBe('ERRORED')
  })

  it('list users drops a List Projects sort field it does not accept', () => {
    const url = requestUrl(listUsersTool, { operation: 'list_users', sortBy: 'LAST_EDITED_AT' })
    expect(url.searchParams.has('sortBy')).toBe(false)
  })

  it('list groups keeps a stored sort field it accepts', () => {
    const url = requestUrl(listGroupsTool, { operation: 'list_groups', sortBy: 'CREATED_AT' })
    expect(url.searchParams.get('sortBy')).toBe('CREATED_AT')
  })

  it('get queried tables ignores the list operations cursors', () => {
    const url = requestUrl(getQueriedTablesTool, {
      operation: 'get_queried_tables',
      projectId: PROJECT_ID,
      after: 'projects-cursor',
      before: 'projects-cursor',
    })
    expect(url.searchParams.has('after')).toBe(false)
    expect(url.searchParams.has('before')).toBe(false)
  })

  it('get queried tables sends its own cursor', () => {
    const url = requestUrl(getQueriedTablesTool, {
      operation: 'get_queried_tables',
      projectId: PROJECT_ID,
      after: 'projects-cursor',
      queriedTablesAfter: 'tables-cursor',
    })
    expect(url.searchParams.get('after')).toBe('tables-cursor')
  })

  it('get project runs keeps a run status an agent passes directly', () => {
    const args = { operation: 'get_project_runs', projectId: PROJECT_ID, statusFilter: 'errored' }
    const built = requestUrl(getProjectRunsTool, args, { operation: 'get_project_runs' })
    expect(built.searchParams.get('statusFilter')).toBe('errored')
  })

  it('list groups keeps a user id an agent passes directly', () => {
    const args = { operation: 'list_groups', userId: PROJECT_ID }
    const built = requestUrl(listGroupsTool, args, { operation: 'list_groups' })
    expect(built.searchParams.get('userId')).toBe(PROJECT_ID)
  })

  it('list groups ignores a Deactivate User id left on the canvas', () => {
    const url = requestUrl(listGroupsTool, { operation: 'list_groups', userId: PROJECT_ID })
    expect(url.searchParams.has('userId')).toBe(false)
  })

  it('get queried tables keeps a cursor an agent passes directly', () => {
    const args = { operation: 'get_queried_tables', projectId: PROJECT_ID, after: 'tables-cursor' }
    const built = requestUrl(getQueriedTablesTool, args, { operation: 'get_queried_tables' })
    expect(built.searchParams.get('after')).toBe('tables-cursor')
  })
})
