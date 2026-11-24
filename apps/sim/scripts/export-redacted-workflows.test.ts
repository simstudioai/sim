/**
 * The export writes production workflow content to disk, so redaction is a data-leak boundary:
 * prose and secrets must not survive, while the structure the round trip proves (references, env
 * tokens, escaping-relevant punctuation, ids, option ids) must.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertOutsideRepo, Redactor, stratify } from '@/scripts/export-redacted-workflows'

const redactor = new Redactor(
  new Map([['customerlookup', 'agent1']]),
  new Map([['apikey', 'var0']])
)

describe('Redactor', () => {
  it('removes prose but keeps references, env tokens and escaping punctuation', () => {
    const out = redactor.string(
      'Email Jane at <customerlookup.email> with {{ACME_KEY}}\n`x` \u0024{y}',
      'body'
    )
    expect(out).toBe('xxxxx xxxx xx <agent1.email> xxxx {{ACME_KEY}}\n`x` \u0024{x}')
    expect(out).not.toMatch(/Jane|Email/)
  })

  it('rewrites variable references to the renamed variable', () => {
    expect(redactor.string('use <variable.apikey>', 'prompt')).toBe('xxx <variable.var0>')
  })

  it('replaces secret-looking fields entirely, but keeps credential references', () => {
    expect(redactor.string('sk-live-abc123', 'apiKey')).toBe('REDACTED')
    expect(redactor.string('Bearer abc', 'Authorization')).toBe('REDACTED')
    expect(redactor.string('cred_8f2', 'credentialId')).toBe('cred_8f2')
  })

  it('keeps ids, positional branch titles and pair modes', () => {
    expect(redactor.string('6f1c1e0a-1b2c-4d3e-8f4a-5b6c7d8e9f00', 'anything')).toBe(
      '6f1c1e0a-1b2c-4d3e-8f4a-5b6c7d8e9f00'
    )
    expect(redactor.string('else if', 'title')).toBe('else if')
    expect(redactor.string('advanced', 'channel')).toBe('advanced')
    expect(redactor.string('Escalate to legal', 'title')).toBe('xxxxxxxx xx xxxxx')
  })

  it('strips URL queries and fragments, which can carry tokens', () => {
    expect(redactor.string('https://hooks.example.com/a/b?token=s3cret#frag', 'url')).toBe(
      'https://hooks.example.com/x/x?redacted#redacted'
    )
  })

  it('redacts URL path segments, which can carry secrets, but keeps their shape', () => {
    const slack = redactor.string(
      'https://hooks.slack.com/services/T0AB12CD/B0XY98ZW/abcDEFsecret123',
      'webhookUrl'
    )
    expect(slack).toBe('https://hooks.slack.com/xxxxxxxx/x0xx00xx/x0xx00xx/xxxxxxxxxxxx000')
    const telegram = redactor.string(
      'https://api.telegram.org/bot123456:AAHsecretTOKEN/send',
      'url'
    )
    expect(telegram).toBe('https://api.telegram.org/xxx000000:xxxxxxxxxxxxxx/xxxx')
  })

  it('keeps and renames references in a URL path', () => {
    expect(redactor.string('https://api.example.com/users/<customerlookup.id>', 'url')).toBe(
      'https://api.example.com/xxxxx/<agent1.id>'
    )
  })

  it('redacts angle-bracketed text that is not a reference', () => {
    const out = redactor.string('Hi, reach Jane Doe <jane.doe@acme.com> or <loop.index>', 'body')
    expect(out).toBe('xx, xxxxx xxxx xxx <xxxx.xxx@xxxx.xxx> xx <loop.index>')
  })

  it('redacts inside JSON text and keeps its keys and shape', () => {
    const rows = JSON.stringify([
      { id: 'r1', title: 'Refund policy', value: '<customerlookup.tier> > 2' },
    ])
    expect(JSON.parse(redactor.string(rows, 'conditions'))).toEqual([
      { id: 'r1', title: 'xxxxxx xxxxxx', value: '<agent1.tier> > 0' },
    ])
  })

  it('leaves option ids alone and redacts free text in subBlocks', () => {
    expect(
      redactor.subBlockValue(
        { id: 'operation', type: 'dropdown', value: 'send_message' },
        'operation'
      )
    ).toEqual({
      id: 'operation',
      type: 'dropdown',
      value: 'send_message',
    })
    expect(
      redactor.subBlockValue({ id: 'text', type: 'long-input', value: 'Hi Bob' }, 'text')
    ).toEqual({
      id: 'text',
      type: 'long-input',
      value: 'xx xxx',
    })
  })
})

describe('stratify', () => {
  it('interleaves strata so a small limit spans types, without duplicates', () => {
    const pools = new Map([
      ['agent:action', ['w1', 'w2', 'w3']],
      ['slack:action', ['w1', 'w4']],
      ['gmail:trigger', ['w5']],
    ])
    expect(stratify(pools, 3)).toEqual(['w1', 'w5', 'w4'])
    expect(stratify(pools, 10)).toEqual(['w1', 'w5', 'w4', 'w2', 'w3'])
  })
})

describe('assertOutsideRepo', () => {
  it('refuses an output directory inside the repository', () => {
    expect(() => assertOutsideRepo(path.resolve(process.cwd(), 'scripts'))).toThrow(
      /inside the repo/
    )
  })
})
