/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildLocalWorkspaceSystemPrompt } from './prompt'

describe('buildLocalWorkspaceSystemPrompt', () => {
  it('includes workspace inventory, permissions, and attached context', () => {
    const prompt = buildLocalWorkspaceSystemPrompt({
      workspaceContext: '## Tables\n- Customers (table-1)',
      userPermission: 'write',
      context: [{ type: 'table', tag: '@active_tab', content: 'Customers table is open.' }],
    })

    expect(prompt).toContain('Current workspace permission: write')
    expect(prompt).toContain('Customers (table-1)')
    expect(prompt).toContain('@active_tab table')
    expect(prompt).toContain('Use user_table for table schema and row operations')
  })
})
