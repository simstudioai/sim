/**
 * @vitest-environment node
 */

import { encryptionMock, encryptionMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
} from '@/lib/execution/private-tool-metadata'
import {
  INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR,
  resolveWorkflowInputSecretProvenance,
} from '@/lib/workflows/executor/input-secret-provenance'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

const SECRET_PROVENANCE = {
  version: 1 as const,
  complete: true,
  entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
  scope: { userId: 'parent-owner', workspaceId: 'workspace-1' },
}

function createHeaders(marked = true): Headers {
  const headers = new Headers()
  if (marked) {
    headers.set(PRIVATE_SECRET_PROVENANCE_HEADER, PRIVATE_SECRET_PROVENANCE_BUNDLE_V1)
  }
  return headers
}

function createPayload(provenance = SECRET_PROVENANCE, key = 'input'): Record<string, unknown> {
  return {
    input: { token: 'secret-value' },
    [PRIVATE_SECRET_PROVENANCE_FIELD]: {
      version: 1,
      complete: true,
      selections: [{ key, provenance }],
    },
  }
}

describe('resolveWorkflowInputSecretProvenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: encryptedValue === 'encrypted-token' ? 'secret-value' : 'other-secret',
    }))
  })

  it('accepts exact same-workspace provenance across different producer and workflow users', async () => {
    await expect(
      resolveWorkflowInputSecretProvenance({
        headers: createHeaders(),
        payload: createPayload(),
        input: { input: { token: 'secret-value' } },
        isInternalJwt: true,
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({ success: true, provenance: SECRET_PROVENANCE })
  })

  it('preserves headerless legacy requests without attaching provenance', async () => {
    await expect(
      resolveWorkflowInputSecretProvenance({
        headers: createHeaders(false),
        payload: { input: { token: 'secret-value' } },
        input: { input: { token: 'secret-value' } },
        isInternalJwt: true,
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({ success: true })
  })

  it('propagates an authenticated incomplete bundle without rejecting the workflow input', async () => {
    await expect(
      resolveWorkflowInputSecretProvenance({
        headers: createHeaders(),
        payload: {
          input: { token: 'secret-value' },
          [PRIVATE_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            selections: [],
          },
        },
        input: { input: { token: 'secret-value' } },
        isInternalJwt: true,
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({
      success: true,
      provenance: { version: 1, complete: false, entries: [] },
    })
  })

  it('propagates an authenticated incomplete input selection without decrypting secrets', async () => {
    await expect(
      resolveWorkflowInputSecretProvenance({
        headers: createHeaders(),
        payload: createPayload({
          version: 1,
          complete: false,
          entries: [],
          scope: { userId: 'parent-owner', workspaceId: 'workspace-1' },
        }),
        input: { input: { token: 'secret-value' } },
        isInternalJwt: true,
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({
      success: true,
      provenance: { version: 1, complete: false, entries: [] },
    })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'marker without a sidecar',
      headers: createHeaders(),
      payload: { input: { token: 'secret-value' } },
      input: { input: { token: 'secret-value' } },
      isInternalJwt: true,
      workspaceId: 'workspace-1',
    },
    {
      name: 'sidecar without a marker',
      headers: createHeaders(false),
      payload: createPayload(),
      input: { input: { token: 'secret-value' } },
      isInternalJwt: true,
      workspaceId: 'workspace-1',
    },
    {
      name: 'non-internal caller',
      headers: createHeaders(),
      payload: createPayload(),
      input: { input: { token: 'secret-value' } },
      isInternalJwt: false,
      workspaceId: 'workspace-1',
    },
    {
      name: 'wrong selection key',
      headers: createHeaders(),
      payload: createPayload(SECRET_PROVENANCE, 'other'),
      input: { input: { token: 'secret-value' } },
      isInternalJwt: true,
      workspaceId: 'workspace-1',
    },
    {
      name: 'wrong workspace',
      headers: createHeaders(),
      payload: createPayload(),
      input: { input: { token: 'secret-value' } },
      isInternalJwt: true,
      workspaceId: 'workspace-2',
    },
    {
      name: 'empty authorized workspace',
      headers: createHeaders(),
      payload: createPayload(),
      input: { input: { token: 'secret-value' } },
      isInternalJwt: true,
      workspaceId: '',
    },
    {
      name: 'provenance not present in the selected input',
      headers: createHeaders(),
      payload: createPayload(),
      input: { input: { token: 'public-value' } },
      isInternalJwt: true,
      workspaceId: 'workspace-1',
    },
  ])('rejects $name', async ({ headers, payload, input, isInternalJwt, workspaceId }) => {
    const result = await resolveWorkflowInputSecretProvenance({
      headers,
      payload,
      input,
      isInternalJwt,
      workspaceId,
    })

    expect(result).toEqual({ success: false, error: INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR })
  })
})
