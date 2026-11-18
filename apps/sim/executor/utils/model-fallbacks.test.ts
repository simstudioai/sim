import { llmBedrockCredentialMock } from '@sim/testing/mocks/llm-bedrock-credential.mock'
import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import { walkModelCandidates } from '@/executor/utils/model-fallbacks'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/lib/internal/llm/bedrock-credential', () => llmBedrockCredentialMock)

const block = { id: 'block-1', config: { params: {} } } as SerializedBlock

function context(): ExecutionContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    blockLogs: [{ blockId: 'block-1', endedAt: '' }],
  } as ExecutionContext
}

/** The primary fails, the first fallback cannot be prepared, then `last` decides. */
function walk(ctx: ExecutionContext, primaryError: Error, last: 'answers' | 'absent') {
  return walkModelCandidates({
    ctx,
    block,
    primary: { model: 'gpt-4o' },
    primaryProviderId: 'openai',
    fallbacks: [{ model: 'gpt-4o-mini' }, ...(last === 'answers' ? [{ model: 'gpt-4.1' }] : [])],
    prepare: async (candidate) => {
      if (candidate.model === 'gpt-4o-mini') throw new Error('cannot take the attachment')
    },
    attempt: async (candidate) => {
      if (candidate.model === 'gpt-4o') throw primaryError
      return candidate.model
    },
    onSkip: vi.fn(),
    onFallback: vi.fn(),
  })
}

beforeEach(() => {
  providersUtilsMockFns.mockGetProviderFromModel.mockReturnValue('openai')
  permissionCheckMockFns.mockValidateModelProvider.mockReset().mockResolvedValue(undefined)
})

describe('walkModelCandidates', () => {
  it('passes over a candidate that cannot be prepared without recording it as a failed model', async () => {
    const ctx = context()
    await expect(walk(ctx, new Error('overloaded'), 'answers')).resolves.toBe('gpt-4.1')
    expect(ctx.blockLogs[0].modelFallbacks).toEqual(['gpt-4o'])
  })

  it('rethrows the last failure when every remaining candidate is skipped', async () => {
    const ctx = context()
    const primaryError = new Error('overloaded')
    await expect(walk(ctx, primaryError, 'absent')).rejects.toBe(primaryError)
    expect(ctx.blockLogs[0].modelFallbacks).toBeUndefined()
  })
})
