import { describe, expect, it } from 'vitest'
import { frozenNameViolations } from './check-sdk-names-frozen'

const BASE = {
  version: 1,
  blocks: {
    slack: {
      namespace: 'slack',
      methods: { send: 'sendMessage', ephemeral: 'sendEphemeral' },
      paramAliases: { action: { oauthCredential: 'credential' } },
    },
    webhook: { namespace: 'trigger.webhook' },
    github: { namespace: 'github', triggers: { github_push: 'push' } },
  },
}

function headWith(edit: (blocks: Record<string, Record<string, unknown>>) => void) {
  const head = structuredClone(BASE) as {
    version: number
    blocks: Record<string, Record<string, unknown>>
  }
  edit(head.blocks)
  return head
}

describe('frozen sdk names', () => {
  it('accepts new blocks, methods, triggers and aliases', () => {
    const head = headWith((blocks) => {
      blocks.linear = { namespace: 'linear', methods: { create: 'createIssue' } }
      ;(blocks.slack.methods as Record<string, string>).react = 'addReaction'
      ;(blocks.github.triggers as Record<string, string>).github_pr = 'pullRequest'
      blocks.slack.paramAliases = {
        action: { oauthCredential: 'credential' },
        trigger: { triggerCredentials: 'credential' },
      }
    })
    expect(frozenNameViolations(BASE, head)).toEqual([])
  })

  it('treats a base without the file as all new', () => {
    expect(frozenNameViolations(null, BASE)).toEqual([])
  })

  it.each([
    [
      'a renamed method',
      (b: Record<string, Record<string, unknown>>) => {
        ;(b.slack.methods as Record<string, string>).send = 'postMessage'
      },
    ],
    [
      'a deleted method',
      (b: Record<string, Record<string, unknown>>) => {
        Reflect.deleteProperty(b.slack.methods as Record<string, string>, 'ephemeral')
      },
    ],
    [
      'a renamed namespace',
      (b: Record<string, Record<string, unknown>>) => {
        b.slack.namespace = 'slackV2'
      },
    ],
    [
      'a deleted block',
      (b: Record<string, Record<string, unknown>>) => {
        Reflect.deleteProperty(b, 'webhook')
      },
    ],
    [
      'a renamed trigger builder',
      (b: Record<string, Record<string, unknown>>) => {
        ;(b.github.triggers as Record<string, string>).github_push = 'onPush'
      },
    ],
    [
      'a deleted alias',
      (b: Record<string, Record<string, unknown>>) => {
        Reflect.deleteProperty(b.slack, 'paramAliases')
      },
    ],
  ])('rejects %s', (_label, edit) => {
    expect(frozenNameViolations(BASE, headWith(edit))).toHaveLength(1)
  })
})
