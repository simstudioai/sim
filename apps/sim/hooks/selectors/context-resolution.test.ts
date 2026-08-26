/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { CanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import {
  applySelectorDependenciesToContext,
  resolveSelectorDependencyValues,
} from '@/hooks/selectors/context-resolution'
import type { SelectorContext } from '@/hooks/selectors/types'

const canonicalIndex: CanonicalIndex = {
  groupsById: {},
  canonicalIdBySubBlockId: {
    domainInput: 'domain',
    tokenInput: 'oauthCredential',
  },
}

describe('selector dependency context resolution', () => {
  it('preserves exact references for opted-in canonical fields', () => {
    const result = resolveSelectorDependencyValues({
      dependencyValues: { domainInput: '{{SHARED_DOMAIN}}' },
      personalEnvironment: { SHARED_DOMAIN: { value: 'personal.example.com' } },
      canonicalIndex,
      serverResolvedContextFields: new Set<keyof SelectorContext>(['domain']),
    })

    expect(result).toEqual({ domainInput: '{{SHARED_DOMAIN}}' })
  })

  it('retains personal browser resolution for non-opted fields', () => {
    const result = resolveSelectorDependencyValues({
      dependencyValues: { tokenInput: '{{PERSONAL_TOKEN}}' },
      personalEnvironment: { PERSONAL_TOKEN: { value: 'personal-plaintext' } },
      canonicalIndex,
      serverResolvedContextFields: new Set(),
    })

    expect(result).toEqual({ tokenInput: 'personal-plaintext' })
  })

  it('keeps embedded interpolation unchanged for opted-in fields', () => {
    const result = resolveSelectorDependencyValues({
      dependencyValues: { domainInput: 'https://{{DOMAIN}}' },
      personalEnvironment: { DOMAIN: { value: 'plaintext.example.com' } },
      canonicalIndex,
      serverResolvedContextFields: new Set<keyof SelectorContext>(['domain']),
    })

    expect(result).toEqual({ domainInput: 'https://{{DOMAIN}}' })
  })

  it('maps preserved references into context and excludes runtime block outputs', () => {
    const context = applySelectorDependenciesToContext({
      context: { workflowId: 'workflow-1' },
      dependencyValues: {
        domainInput: '{{SHARED_DOMAIN}}',
        tokenInput: '<runtime.block.output>',
      },
      canonicalIndex,
    })

    expect(context).toEqual({ workflowId: 'workflow-1', domain: '{{SHARED_DOMAIN}}' })
  })
})
