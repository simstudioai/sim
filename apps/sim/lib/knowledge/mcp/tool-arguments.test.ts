/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { toolCallInputIssues } from '@/lib/knowledge/mcp/tool-arguments'

const searchCall = (args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'search', arguments: args },
})

describe('toolCallInputIssues', () => {
  it('names the fields a native query carries that the schema does not know', () => {
    const issues = toolCallInputIssues(
      searchCall({
        query: 'roadmap',
        nativeQueries: [{ provider: 'jira', query: 'roadmap', limit: 5 }],
      })
    )
    expect(issues?.issues).toContainEqual({
      code: 'unrecognized_keys',
      path: 'nativeQueries.0',
      keys: ['limit'],
    })
  })
})
