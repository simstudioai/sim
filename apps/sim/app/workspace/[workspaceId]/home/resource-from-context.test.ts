/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ChatContext } from '@/stores/panel'
import { resolveResourceFromContext } from './resource-from-context'

describe('resolveResourceFromContext', () => {
  it.each([
    [
      { kind: 'skill', skillId: 'skill-1', label: 'Research' },
      { type: 'skill', id: 'skill-1' },
    ],
    [
      { kind: 'mcp', serverId: 'server-1', label: 'DeepWiki' },
      { type: 'mcp_server', id: 'server-1' },
    ],
  ] satisfies [ChatContext, { type: string; id: string }][])(
    'maps %s slash context to its panel resource',
    (context, expected) => {
      expect(resolveResourceFromContext(context)).toEqual(expected)
    }
  )

  it('does not turn slash commands into resources', () => {
    expect(
      resolveResourceFromContext({ kind: 'slash_command', command: 'help', label: 'Help' })
    ).toBeNull()
  })
})
