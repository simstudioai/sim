/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  announceAgentApplying,
  clearAgentApplying,
  isAgentStreamLeader,
} from './agent-stream-leader'

/** An Awareness with explicit peer states injected (self, if present, carries no `agentApplying`). */
function awarenessWith(entries: Array<[number, Record<string, unknown>]>): Awareness {
  const aw = new Awareness(new Y.Doc())
  const states = aw.getStates() as Map<number, Record<string, unknown>>
  for (const [clientId, state] of entries) states.set(clientId, state)
  return aw
}

describe('agent-stream leader election', () => {
  it('a sole announcer is the leader', () => {
    expect(isAgentStreamLeader(awarenessWith([[5, { agentApplying: true }]]), 5)).toBe(true)
  })

  it('the lowest clientID among announcers leads; higher announcers do not', () => {
    const aw = awarenessWith([
      [7, { agentApplying: true }],
      [3, { agentApplying: true }],
      [9, { user: { name: 'someone else, not applying' } }],
    ])
    expect(isAgentStreamLeader(aw, 3)).toBe(true)
    expect(isAgentStreamLeader(aw, 7)).toBe(false)
  })

  it('a client that is not announcing is never the leader', () => {
    expect(isAgentStreamLeader(awarenessWith([[3, { agentApplying: true }]]), 8)).toBe(false)
  })

  it('with no announcers, nobody leads', () => {
    expect(isAgentStreamLeader(awarenessWith([[3, { user: {} }]]), 3)).toBe(false)
  })

  it('announce makes self the leader; clear relinquishes it', () => {
    const doc = new Y.Doc()
    const aw = new Awareness(doc)
    announceAgentApplying(aw)
    expect(aw.getLocalState()?.agentApplying).toBe(true)
    expect(isAgentStreamLeader(aw, doc.clientID)).toBe(true)

    clearAgentApplying(aw)
    expect(aw.getLocalState()?.agentApplying ?? null).toBeNull()
    expect(isAgentStreamLeader(aw, doc.clientID)).toBe(false)
  })
})
