/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { clearCredentialInValue } from '@/lib/credentials/deletion'

const TARGET = 'cred_target123'
const OTHER = 'cred_other999'

describe('clearCredentialInValue', () => {
  it('clears matching subBlock value with id="credential"', () => {
    const input = { id: 'credential', type: 'oauth-input', value: TARGET }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    expect(result.value).toEqual({ id: 'credential', type: 'oauth-input', value: '' })
  })

  it('clears matching subBlock value with id="manualCredential"', () => {
    const input = { id: 'manualCredential', type: 'short-input', value: TARGET }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    expect(result.value).toEqual({ id: 'manualCredential', type: 'short-input', value: '' })
  })

  it('clears matching subBlock value with id="triggerCredentials"', () => {
    const input = { id: 'triggerCredentials', value: TARGET }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    expect((result.value as { value: string }).value).toBe('')
  })

  it('leaves unrelated subBlock value untouched', () => {
    const input = { id: 'someOtherField', value: TARGET }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(input)
  })

  it('leaves matching subBlock with non-matching value untouched', () => {
    const input = { id: 'credential', value: OTHER }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(input)
  })

  it('clears nested tools[].params.credential', () => {
    const input = {
      id: 'tools',
      value: [
        { type: 'gmail_send', params: { credential: TARGET, to: 'a@b.com' } },
        { type: 'slack_message', params: { credential: OTHER, channel: '#x' } },
      ],
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as { value: Array<{ params: { credential: string } }> }
    expect(value.value[0].params.credential).toBe('')
    expect(value.value[1].params.credential).toBe(OTHER)
  })

  it('walks workflow_blocks-style keyed subBlocks structure', () => {
    const input = {
      credential: { id: 'credential', value: TARGET },
      messages: { id: 'messages', value: 'hello' },
      tools: {
        id: 'tools',
        value: [{ type: 'x', params: { credential: TARGET } }],
      },
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as typeof input
    expect(value.credential.value).toBe('')
    expect(value.messages.value).toBe('hello')
    expect(value.tools.value[0].params.credential).toBe('')
  })

  it('walks deployment-style nested blocks structure', () => {
    const input = {
      blocks: {
        block1: {
          subBlocks: {
            credential: { id: 'credential', value: TARGET },
          },
        },
        block2: {
          subBlocks: {
            other: { id: 'other', value: 'unrelated' },
          },
        },
      },
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as typeof input
    expect(value.blocks.block1.subBlocks.credential.value).toBe('')
    expect(value.blocks.block2.subBlocks.other.value).toBe('unrelated')
  })

  it('returns same reference when no changes are made', () => {
    const input = {
      blocks: {
        block1: {
          subBlocks: { credential: { id: 'credential', value: OTHER } },
        },
      },
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(input)
  })

  it('does not match outer "credential" key whose value is an object wrapper', () => {
    const input = { credential: { id: 'credential', value: TARGET } }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as { credential: { id: string; value: string } }
    expect(value.credential).toEqual({ id: 'credential', value: '' })
  })

  it('clears params.credential string directly even when not nested in tools', () => {
    const input = { params: { credential: TARGET, channel: '#x' } }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    expect((result.value as typeof input).params).toEqual({ credential: '', channel: '#x' })
  })

  it('does not match "credential" key when value is a different string', () => {
    const input = { credential: 'cred_unrelated' }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(input)
  })

  it('handles primitives and null', () => {
    expect(clearCredentialInValue(null, TARGET)).toEqual({ value: null, changed: false })
    expect(clearCredentialInValue('string', TARGET)).toEqual({ value: 'string', changed: false })
    expect(clearCredentialInValue(42, TARGET)).toEqual({ value: 42, changed: false })
  })

  it('clears multiple references in a single pass', () => {
    const input = {
      blocks: {
        a: { subBlocks: { credential: { id: 'credential', value: TARGET } } },
        b: { subBlocks: { triggerCredentials: { id: 'triggerCredentials', value: TARGET } } },
        c: {
          subBlocks: {
            tools: {
              id: 'tools',
              value: [{ params: { credential: TARGET } }, { params: { credential: TARGET } }],
            },
          },
        },
      },
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as typeof input
    expect(value.blocks.a.subBlocks.credential.value).toBe('')
    expect(value.blocks.b.subBlocks.triggerCredentials.value).toBe('')
    expect(value.blocks.c.subBlocks.tools.value[0].params.credential).toBe('')
    expect(value.blocks.c.subBlocks.tools.value[1].params.credential).toBe('')
  })
})
