import { describe, expect, it } from 'vitest'
import { ASK_MODE_AGENT_CONTEXT, withAskModeContext } from '@/lib/copilot/chat/ask-mode'

const knowledge = { type: 'knowledge', content: '', tag: '@Sim Search', path: 'knowledge/x.json' }

describe('withAskModeContext', () => {
  it('appends the Ask skill after the attached contexts on an Ask turn', () => {
    expect(withAskModeContext([knowledge], 'ask')).toEqual([knowledge, ASK_MODE_AGENT_CONTEXT])
  })

  it('leaves every other mode untouched', () => {
    for (const mode of ['agent', 'build', 'plan', undefined]) {
      expect(withAskModeContext([knowledge], mode)).toEqual([knowledge])
    }
  })

  it('renders as a skill the agent injects for the turn', () => {
    expect(ASK_MODE_AGENT_CONTEXT.type).toBe('skill')
    expect(ASK_MODE_AGENT_CONTEXT.content).toContain('<source>')
    expect(ASK_MODE_AGENT_CONTEXT.content).toContain('query')
  })
})
