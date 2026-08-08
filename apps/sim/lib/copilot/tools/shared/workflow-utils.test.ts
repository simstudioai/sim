/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { formatNormalizedWorkflowForCopilot } from './workflow-utils'

vi.unmock('@/blocks/registry')

describe('formatNormalizedWorkflowForCopilot', () => {
  it('redacts credentials from secretless deployed-state projections', () => {
    const formatted = formatNormalizedWorkflowForCopilot(
      {
        blocks: {
          slack: {
            id: 'slack',
            type: 'slack',
            name: 'Slack',
            enabled: true,
            subBlocks: {
              credential: { id: 'credential', type: 'oauth-input', value: 'cred-private' },
              manualCredential: {
                id: 'manualCredential',
                type: 'short-input',
                value: 'cred-private-advanced',
              },
              message: { id: 'message', type: 'long-input', value: 'hello' },
            },
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      },
      { secretless: true }
    )

    expect(formatted).not.toContain('cred-private')
    expect(formatted).toContain('hello')
  })
})
