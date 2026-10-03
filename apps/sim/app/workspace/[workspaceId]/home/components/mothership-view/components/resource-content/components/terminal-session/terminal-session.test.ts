import { describe, expect, it } from 'vitest'
import { terminalSelectionSnapshot } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-session'

describe('terminal selection snapshots', () => {
  it('does not include the exclusive next row when a selection ends at column zero', () => {
    expect(
      terminalSelectionSnapshot('first line\n', {
        start: { x: 0, y: 8 },
        end: { x: 0, y: 9 },
      })
    ).toEqual({ text: 'first line\n', startLine: 9, endLine: 9 })
  })
})
