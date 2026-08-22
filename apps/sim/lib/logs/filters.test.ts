/**
 * @vitest-environment node
 */
import { flattenMockConditions } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { buildFilterConditions } from '@/lib/logs/filters'

/**
 * The bound operands of every `ILIKE` clause the filter set produces.
 *
 * The mocked `sql` tag renders interpolations as `?`, so the columns a clause
 * touches are visible in its params rather than in its text. The mock spells
 * them table-qualified (`workflow.name`, not `name`), which is what makes
 * `folder.name` and `workflow.name` distinguishable here at all.
 */
function likeClauseParams(params: Parameters<typeof buildFilterConditions>[0]): unknown[][] {
  const condition = buildFilterConditions(params, { useSimpleLevelFilter: true })
  return flattenMockConditions(condition)
    .map((node) => (node as { toSQL?: () => { sql: string; params: unknown[] } }).toSQL?.())
    .filter((fragment): fragment is { sql: string; params: unknown[] } =>
      Boolean(fragment?.sql.includes('ILIKE'))
    )
    .map((fragment) => fragment.params)
}

describe('folderName filter', () => {
  /**
   * The regression this pins: `folderName` used to ILIKE `workflow.name`, a
   * verbatim copy of the clause for `workflowName` directly above it, so a
   * folder search quietly matched workflow names and reported the wrong runs
   * with no error at all.
   */
  it('matches against the folder table rather than the workflow name', () => {
    const [clause] = likeClauseParams({ workspaceId: 'workspace-1', folderName: 'support' })

    expect(clause).toContain('workflow.folderId')
    expect(clause).toContain('folder.name')
    expect(clause).toContain('%support%')
    expect(clause).not.toContain('workflow.name')
    expect(JSON.stringify(clause)).toContain('folder.deletedAt')
  })

  it('is a different predicate from the workflow-name filter', () => {
    const byFolder = likeClauseParams({ workspaceId: 'workspace-1', folderName: 'support' })
    const byWorkflow = likeClauseParams({ workspaceId: 'workspace-1', workflowName: 'support' })

    expect(byFolder).not.toEqual(byWorkflow)
  })

  it('leaves the workflow-name filter matching the workflow name alone', () => {
    const [clause] = likeClauseParams({ workspaceId: 'workspace-1', workflowName: 'support' })

    expect(clause).toEqual(['workflow.name', '%support%'])
  })

  it('adds no predicate when neither name filter is set', () => {
    expect(likeClauseParams({ workspaceId: 'workspace-1' })).toEqual([])
  })
})
