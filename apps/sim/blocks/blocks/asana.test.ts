import { describe, expect, it } from 'vitest'
import { AsanaBlock } from '@/blocks/blocks/asana'
import type { BlockToolParamsContext } from '@/blocks/types'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => AsanaBlock.tools.config?.params?.(inputs, context) ?? {}

/**
 * On an agent call the model supplies args under the tool's own param names (`workspace`, `text`,
 * `taskGid`, array `projects`/`followers`); the per-operation canvas fields are never rendered.
 * The handler forwards `{ ...inputs, ...mapped }`.
 */
describe('AsanaBlock agent tool calls', () => {
  const agentCall = (operation: string, args: Record<string, unknown>): Record<string, unknown> => {
    const inputs = { ...args, operation }
    return { ...inputs, ...buildParams(inputs, { operation }) }
  }

  it('keeps the model workspace, project, limit, and offset on get_task', () => {
    const mapped = agentCall('get_task', {
      workspace: '111',
      assignee: 'me',
      project: '222',
      limit: 10,
      offset: 'tok',
    })
    expect(mapped).toMatchObject({
      workspace: '111',
      assignee: 'me',
      project: '222',
      limit: 10,
      offset: 'tok',
    })
  })

  it('keeps the model text and array projects on search_tasks', () => {
    const mapped = agentCall('search_tasks', {
      workspace: '111',
      text: 'bug',
      projects: ['1', '2'],
      limit: 5,
    })
    expect(mapped).toMatchObject({ text: 'bug', projects: ['1', '2'], limit: 5 })
  })

  it('keeps the model text on add_comment', () => {
    expect(agentCall('add_comment', { taskGid: '1', text: 'hello' }).text).toBe('hello')
  })

  it('keeps the model taskGid on create_subtask', () => {
    expect(agentCall('create_subtask', { taskGid: '9', name: 'Sub' }).taskGid).toBe('9')
  })

  it('keeps the model workspace on create_project', () => {
    expect(agentCall('create_project', { workspace: '111', name: 'P' }).workspace).toBe('111')
  })

  it('accepts array followers on add_followers', () => {
    expect(agentCall('add_followers', { taskGid: '1', followers: ['3', '4'] }).followers).toEqual([
      '3',
      '4',
    ])
  })
})

describe('AsanaBlock canvas inputs', () => {
  it('drops a raw workspace left over from another operation under get_task', () => {
    const inputs = { operation: 'get_task', workspace: 'stale', getTasks_workspace: '111' }
    expect({ ...inputs, ...buildParams(inputs) }.workspace).toBe('111')
  })

  it('maps the canvas pagination and search limit fields', () => {
    expect(
      buildParams({ operation: 'get_task', getTasks_workspace: '1', getTasks_offset: 'tok' })
    ).toMatchObject({ workspace: '1', offset: 'tok' })
    expect(
      buildParams({ operation: 'search_tasks', workspace: '1', searchTasks_limit: '25' })
    ).toMatchObject({ limit: 25 })
  })
})
