import { describe, expect, it } from 'vitest'
import { maskSecretText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/password-mask'

describe('maskSecretText', () => {
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
})
