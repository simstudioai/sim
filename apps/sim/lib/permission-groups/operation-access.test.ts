/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectDeniedOperationIds,
  isOperationAllowed,
  type OperationGateBlock,
  pickDefaultOperation,
  resolveOperationToolId,
} from '@/lib/permission-groups/operation-access'

/** A block that resolves its tool from the operation, like most integrations. */
const selectorBlock: OperationGateBlock = {
  tools: {
    access: ['slack_message', 'slack_canvas', 'slack_read'],
    config: {
      tool: (params) => {
        const map: Record<string, string> = {
          send: 'slack_message',
          canvas: 'slack_canvas',
          read: 'slack_read',
        }
        const toolId = map[params.operation as string]
        if (!toolId) throw new Error(`unknown operation: ${params.operation}`)
        return toolId
      },
    },
  },
}

/** A block with no selector, whose operation ids are its tool ids. */
const bareBlock: OperationGateBlock = {
  tools: { access: ['sqs_send', 'sqs_receive'] },
}

const singleToolBlock: OperationGateBlock = {
  tools: { access: ['dropcontact_enrich_contact'] },
}

const denyAll = () => false
const allowAll = () => true
const deny = (...toolIds: string[]) => {
  const denied = new Set(toolIds)
  return (toolId: string) => !denied.has(toolId)
}

describe('resolveOperationToolId', () => {
  it('resolves through the block tool selector', () => {
    expect(resolveOperationToolId(selectorBlock, 'canvas')).toBe('slack_canvas')
  })

  it('returns the only tool when the block has no selection to make', () => {
    expect(resolveOperationToolId(singleToolBlock, 'anything')).toBe('dropcontact_enrich_contact')
  })

  it('treats an operation id as a tool id when the block has no selector', () => {
    expect(resolveOperationToolId(bareBlock, 'sqs_receive')).toBe('sqs_receive')
  })

  it('returns null rather than guessing when the selector throws', () => {
    expect(resolveOperationToolId(selectorBlock, 'not-an-operation')).toBeNull()
  })

  it('returns null for a block with no tools', () => {
    expect(resolveOperationToolId({ tools: { access: [] } }, 'send')).toBeNull()
    expect(resolveOperationToolId(null, 'send')).toBeNull()
    expect(resolveOperationToolId(undefined, 'send')).toBeNull()
  })
})

describe('isOperationAllowed', () => {
  it('denies an operation whose tool the group denies', () => {
    expect(isOperationAllowed(selectorBlock, 'canvas', deny('slack_canvas'))).toBe(false)
    expect(isOperationAllowed(selectorBlock, 'send', deny('slack_canvas'))).toBe(true)
  })

  it('allows an unresolvable operation, leaving the server as the gate', () => {
    expect(isOperationAllowed(selectorBlock, 'not-an-operation', denyAll)).toBe(true)
  })
})

describe('collectDeniedOperationIds', () => {
  it('collects only the operations whose tools are denied', () => {
    const denied = collectDeniedOperationIds(
      selectorBlock,
      ['send', 'canvas', 'read'],
      deny('slack_message', 'slack_read')
    )
    expect([...denied]).toEqual(['send', 'read'])
  })

  it('is empty when nothing is denied', () => {
    expect(collectDeniedOperationIds(selectorBlock, ['send', 'canvas'], allowAll).size).toBe(0)
  })
})

describe('pickDefaultOperation', () => {
  const candidates = ['send', 'canvas', 'read']

  it('keeps the preferred operation when the group allows it', () => {
    expect(pickDefaultOperation(selectorBlock, candidates, allowAll, 'canvas')).toBe('canvas')
  })

  it('falls back to the first allowed operation when the preferred one is denied', () => {
    expect(pickDefaultOperation(selectorBlock, candidates, deny('slack_message'), 'send')).toBe(
      'canvas'
    )
  })

  it('takes the first allowed operation when there is no preference', () => {
    expect(pickDefaultOperation(selectorBlock, candidates, deny('slack_message'))).toBe('canvas')
  })

  it('returns undefined when every candidate is denied', () => {
    expect(
      pickDefaultOperation(
        selectorBlock,
        candidates,
        deny('slack_message', 'slack_canvas', 'slack_read'),
        'send'
      )
    ).toBeUndefined()
  })

  it('keeps a preferred operation it cannot resolve, matching the permissive gate', () => {
    expect(pickDefaultOperation(selectorBlock, candidates, denyAll, 'not-an-operation')).toBe(
      'not-an-operation'
    )
  })
})
