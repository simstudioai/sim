/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  maskSecretText,
  PASSWORD_MASKED_SUBBLOCK_TYPES,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/password-mask'

describe('maskSecretText', () => {
  it('replaces every character of a single-line secret', () => {
    expect(maskSecretText('hunter2')).toBe('•••••••')
  })

  it('leaves nothing of the plaintext behind', () => {
    const secret = 'SIM-TEST-CREDENTIAL-MARKER-value'
    const masked = maskSecretText(secret)
    expect(masked).not.toContain('SIM-TEST-CREDENTIAL-MARKER')
    expect(masked).not.toContain('KEY')
    expect(new Set(masked)).toEqual(new Set(['•']))
  })

  it('preserves line breaks so a multi-line secret keeps its shape', () => {
    const value = 'marker-a\nabcd\nmarker-b'
    const masked = maskSecretText(value)
    expect(masked.split('\n')).toEqual(value.split('\n').map((line) => '•'.repeat(line.length)))
  })

  it('returns an empty string for an empty value', () => {
    expect(maskSecretText('')).toBe('')
  })
})

describe('PASSWORD_MASKED_SUBBLOCK_TYPES', () => {
  it('covers every renderer that reads the password flag', () => {
    expect([...PASSWORD_MASKED_SUBBLOCK_TYPES].sort()).toEqual([
      'code',
      'long-input',
      'short-input',
      'table',
    ])
  })
})
