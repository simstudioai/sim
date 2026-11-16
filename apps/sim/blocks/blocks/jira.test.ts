import { describe, expect, it } from 'vitest'
import { JiraBlock } from '@/blocks/blocks/jira'

/**
 * What a tool call (agent, Pi, Human v2) hands the tool: the merged stored-row and model args,
 * overlaid with the block mapper's output. The operation arrives only in `context`.
 */
function toolCallParams(operation: string, args: Record<string, unknown>) {
  const mapper = JiraBlock.tools.config?.params
  if (!mapper) throw new Error('Jira block is missing tools.config.params')
  return { ...args, ...mapper(args, { operation }) }
}

describe('JiraBlock tool calls', () => {
  it('maps fields set on the agent tool row to the tool param names', () => {
    expect(
      toolCallParams('add_comment', { issueKey: 'PROJ-1', commentBody: 'From the row' }).body
    ).toBe('From the row')
    expect(
      toolCallParams('get_users', { userAccountId: 'acc-1', usersMaxResults: '5' })
    ).toMatchObject({ accountId: 'acc-1', maxResults: 5 })
  })

  it.each([
    ['add_comment', { issueKey: 'PROJ-1', body: 'Model comment' }],
    ['transition', { issueKey: 'PROJ-1', transitionId: '31', comment: 'Done', fields: { a: 1 } }],
    ['update_worklog', { issueKey: 'PROJ-1', worklogId: '9', timeSpentSeconds: 600 }],
    ['search_users', { query: 'ada', maxResults: 10, startAt: 20 }],
    ['list_projects', { query: 'core', maxResults: 10, startAt: 0 }],
    [
      'create_link',
      { inwardIssueKey: 'A-1', outwardIssueKey: 'B-1', linkType: 'Blocks', comment: 'x' },
    ],
    ['update', { issueKey: 'PROJ-1', parent: { key: 'PROJ-0' }, notifyUsers: false }],
  ])('keeps model args for %s', (operation, args) => {
    expect(toolCallParams(operation, args)).toMatchObject(args)
  })

  it('accepts model-sent arrays for list params instead of throwing', () => {
    const params = toolCallParams('write', {
      projectId: '10000',
      summary: 'Bug',
      labels: ['a', ' b '],
      parent: { key: 'PROJ-0' },
    })
    expect(params.labels).toEqual(['a', 'b'])
    expect(params.parent).toEqual({ key: 'PROJ-0' })
    expect(toolCallParams('search', { jql: 'x', fields: ['key', 'summary'] }).fields).toEqual([
      'key',
      'summary',
    ])
    expect(
      toolCallParams('delete', { issueKey: 'PROJ-1', deleteSubtasks: true }).deleteSubtasks
    ).toBe(true)
  })
})
