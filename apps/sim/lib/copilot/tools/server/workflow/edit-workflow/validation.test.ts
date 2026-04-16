/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeConditionRouterIds } from './builders'

const { mockValidateSelectorIds } = vi.hoisted(() => ({
  mockValidateSelectorIds: vi.fn(),
}))

const conditionBlockConfig = {
  type: 'condition',
  name: 'Condition',
  outputs: {},
  subBlocks: [{ id: 'conditions', type: 'condition-input' }],
}

const oauthBlockConfig = {
  type: 'slack',
  name: 'Slack',
  outputs: {},
  subBlocks: [{ id: 'credential', type: 'oauth-input' }],
}

const routerBlockConfig = {
  type: 'router_v2',
  name: 'Router',
  outputs: {},
  subBlocks: [{ id: 'routes', type: 'router-input' }],
}

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) =>
    type === 'condition'
      ? conditionBlockConfig
      : type === 'slack'
        ? oauthBlockConfig
        : type === 'router_v2'
          ? routerBlockConfig
          : undefined,
}))

vi.mock('@/lib/copilot/validation/selector-validator', () => ({
  validateSelectorIds: mockValidateSelectorIds,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isHosted: false,
}))

vi.mock('@/providers/utils', () => ({
  getHostedModels: () => [],
}))

import { preValidateCredentialInputs, validateInputsForBlock } from './validation'

describe('validateInputsForBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('accepts condition-input arrays with arbitrary item ids', () => {
    const result = validateInputsForBlock(
      'condition',
      {
        conditions: JSON.stringify([
          { id: 'cond-1-if', title: 'if', value: 'true' },
          { id: 'cond-1-else', title: 'else', value: '' },
        ]),
      },
      'condition-1'
    )

    expect(result.validInputs.conditions).toBeDefined()
    expect(result.errors).toHaveLength(0)
  })

  it('rejects non-array condition-input values', () => {
    const result = validateInputsForBlock('condition', { conditions: 'not-json' }, 'condition-1')

    expect(result.validInputs.conditions).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('expected a JSON array')
  })
})

describe('normalizeConditionRouterIds', () => {
  it('assigns canonical block-scoped ids to condition branches', () => {
    const input = JSON.stringify([
      { id: 'whatever', title: 'if', value: 'true' },
      { id: 'anything', title: 'else if', value: 'false' },
      { id: 'doesnt-matter', title: 'else', value: '' },
    ])

    const result = normalizeConditionRouterIds('block-1', 'conditions', input)
    const parsed = JSON.parse(result as string)

    expect(parsed[0].id).toBe('block-1-if')
    expect(parsed[1].id).toBe('block-1-else-if-0')
    expect(parsed[2].id).toBe('block-1-else')
  })

  it('assigns canonical block-scoped ids to router routes', () => {
    const input = [
      { id: 'route-a', title: 'Support', value: 'support query' },
      { id: 'route-b', title: 'Sales', value: 'sales query' },
    ]

    const result = normalizeConditionRouterIds('block-1', 'routes', input)
    const arr = result as any[]

    expect(arr[0].id).toBe('block-1-route1')
    expect(arr[1].id).toBe('block-1-route2')
  })

  it('passes through non-condition/router keys unchanged', () => {
    const input = 'some value'
    expect(normalizeConditionRouterIds('block-1', 'code', input)).toBe(input)
  })
})

describe('preValidateCredentialInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: ['shared-cred-1'], invalid: [] })
  })

  it('passes workspace context when validating shared oauth credentials', async () => {
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'block-1',
        params: {
          type: 'slack',
          inputs: {
            credential: 'shared-cred-1',
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(mockValidateSelectorIds).toHaveBeenCalledWith('oauth-input', ['shared-cred-1'], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(result.filteredOperations[0]?.params?.inputs?.credential).toBe('shared-cred-1')
    expect(result.errors).toHaveLength(0)
  })
})
