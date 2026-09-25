/**
 * Tests for the exported field-analysis helpers in serializer/index.ts
 * (collectBlockFieldIssues / extractBlockParams) — the single source of truth
 * shared by the serializer's required-field validation and the copilot lint.
 */
import { blocksMock, toolsMetadataMock, toolsUtilsMock } from '@sim/testing/mocks'
import { describe, expect, it, vi } from 'vitest'

const { svcConfig } = vi.hoisted(() => ({ svcConfig: { value: null as any } }))

vi.mock('@/tools/utils', () => toolsUtilsMock)
vi.mock('@/tools/metadata', () => toolsMetadataMock)
vi.mock('@/blocks', () => ({
  ...blocksMock,
  getBlock: (type: string) => (type === 'svc' ? svcConfig.value : blocksMock.getBlock(type)),
}))

import { collectBlockFieldIssues, extractBlockParams } from '@/serializer/index'

function block(overrides: Record<string, any> = {}) {
  return {
    id: 'b1',
    type: 'x',
    name: 'My Block',
    enabled: true,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    data: {},
    ...overrides,
  } as any
}

function config(subBlocks: any[], overrides: Record<string, any> = {}) {
  return {
    name: 'X',
    category: 'tools',
    tools: { access: [] },
    subBlocks,
    ...overrides,
  } as any
}

describe('collectBlockFieldIssues', () => {
  it('reports a missing required field (active mode empty)', () => {
    const cfg = config([{ id: 'apiKey', title: 'API Key', type: 'short-input', required: true }])
    const issues = collectBlockFieldIssues(block({ subBlocks: { apiKey: { value: '' } } }), cfg, {})
    expect(issues.missingRequiredFields).toEqual(['API Key'])
    expect(issues.inactiveModeValues).toEqual([])
  })

  it('skips disabled blocks', () => {
    const cfg = config([{ id: 'apiKey', title: 'API Key', type: 'short-input', required: true }])
    const issues = collectBlockFieldIssues(block({ enabled: false }), cfg, {})
    expect(issues).toEqual({ missingRequiredFields: [], inactiveModeValues: [] })
  })

  it('skips trigger-mode blocks', () => {
    const cfg = config([{ id: 'apiKey', title: 'API Key', type: 'short-input', required: true }])
    const issues = collectBlockFieldIssues(block({ triggerMode: true }), cfg, {})
    expect(issues).toEqual({ missingRequiredFields: [], inactiveModeValues: [] })
  })

  it('only flags a condition-gated required field when its condition is met', () => {
    const cfg = config([
      { id: 'mode', type: 'dropdown' },
      {
        id: 'topic',
        title: 'Topic',
        type: 'short-input',
        required: { field: 'mode', value: 'advanced' },
      },
    ])

    const inactive = collectBlockFieldIssues(
      block({ subBlocks: { mode: { value: 'basic' } } }),
      cfg,
      { mode: 'basic' }
    )
    expect(inactive.missingRequiredFields).toEqual([])

    const active = collectBlockFieldIssues(
      block({ subBlocks: { mode: { value: 'advanced' } } }),
      cfg,
      { mode: 'advanced' }
    )
    expect(active.missingRequiredFields).toEqual(['Topic'])
  })

  it('flags a credential value stranded on the inactive member', () => {
    const cfg = config([
      {
        id: 'credential',
        title: 'Account',
        type: 'oauth-input',
        canonicalParamId: 'cred',
        mode: 'basic',
        required: true,
      },
      {
        id: 'manualCredential',
        title: 'Account',
        type: 'short-input',
        canonicalParamId: 'cred',
        mode: 'advanced',
        required: true,
      },
    ])

    // canonicalModes forces 'basic', but the value lives on the advanced member.
    const issues = collectBlockFieldIssues(
      block({
        advancedMode: false,
        data: { canonicalModes: { cred: 'basic' } },
        subBlocks: { credential: { value: '' }, manualCredential: { value: 'cred_123' } },
      }),
      cfg,
      { cred: '' }
    )

    expect(issues.inactiveModeValues).toEqual([
      {
        canonicalId: 'cred',
        activeMemberId: 'credential',
        inactiveMemberId: 'manualCredential',
        kind: 'credential',
      },
    ])
    // The active (basic) member is empty + required -> also a missing field.
    expect(issues.missingRequiredFields).toEqual(['Account'])
  })
})

describe('extractBlockParams', () => {
  it('resolves a canonical pair to its canonical id (advanced value wins when basic empty)', () => {
    svcConfig.value = config([
      {
        id: 'credential',
        title: 'Account',
        type: 'oauth-input',
        canonicalParamId: 'cred',
        mode: 'basic',
      },
      {
        id: 'manualCredential',
        title: 'Account',
        type: 'short-input',
        canonicalParamId: 'cred',
        mode: 'advanced',
      },
    ])

    const params = extractBlockParams(
      block({
        type: 'svc',
        advancedMode: false,
        subBlocks: { credential: { value: '' }, manualCredential: { value: 'cred_123' } },
      })
    )

    expect(params.cred).toBe('cred_123')
    expect(params.credential).toBeUndefined()
    expect(params.manualCredential).toBeUndefined()
  })

  describe('legacy advancedMode', () => {
    /**
     * `advancedMode` is a block flag the editor stopped writing in #6458, but stored workflows
     * still carry it. It means "the ADVANCED member of a pair wins", which only has meaning for a
     * group that has one.
     */
    const nonPair = () =>
      config([
        {
          id: 'personalApiKey',
          title: 'Personal API Key',
          type: 'short-input',
          canonicalParamId: 'apiKey',
          required: true,
        },
      ])

    it('keeps a canonical group that has no advanced member', () => {
      svcConfig.value = nonPair()

      const params = extractBlockParams(
        block({
          type: 'svc',
          advancedMode: true,
          subBlocks: { personalApiKey: { value: 'phx_secret' } },
        })
      )

      // Regression: forcing 'advanced' on a group with no advanced member left `chosen`
      // undefined while the source-id sweep still deleted `personalApiKey`, so the block
      // serialized with neither key and failed at run time on a field the user had filled.
      expect(params.apiKey).toBe('phx_secret')
      expect(params.personalApiKey).toBeUndefined()
    })

    it('does not report the surviving value as a missing required field', () => {
      const cfg = nonPair()
      const state = block({
        type: 'svc',
        advancedMode: true,
        subBlocks: { personalApiKey: { value: 'phx_secret' } },
      })

      expect(
        collectBlockFieldIssues(state, cfg, extractBlockParams(state)).missingRequiredFields
      ).toEqual([])
    })
  })
})
