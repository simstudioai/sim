import { describe, expect, it, vi } from 'vitest'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

describe('resolveEnvVarReferences provenance', () => {
  it('reports each successful exact, embedded, and deep substitution', () => {
    const onResolved = vi.fn()

    const result = resolveEnvVarReferences(
      {
        exact: '{{TOKEN}}',
        embedded: 'Bearer {{TOKEN}} and {{OTHER}}',
        missing: '{{MISSING}}',
      },
      { TOKEN: 'secret', OTHER: 'other-secret' },
      { deep: true, onResolved }
    )

    expect(result).toEqual({
      exact: 'secret',
      embedded: 'Bearer secret and other-secret',
      missing: '{{MISSING}}',
    })
    expect(onResolved.mock.calls).toEqual([
      ['TOKEN', 'secret'],
      ['TOKEN', 'secret'],
      ['OTHER', 'other-secret'],
    ])
  })

  it('does not report disabled embedded or missing references', () => {
    const onResolved = vi.fn()
    expect(
      resolveEnvVarReferences(
        'prefix {{TOKEN}} {{MISSING}}',
        { TOKEN: 'secret' },
        {
          allowEmbedded: false,
          onResolved,
        }
      )
    ).toBe('prefix {{TOKEN}} {{MISSING}}')
    expect(onResolved).not.toHaveBeenCalled()
  })
})
