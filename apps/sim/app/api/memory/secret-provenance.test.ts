/**
 * @vitest-environment node
 */

import { memorySecretProvenance } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthType } from '@/lib/auth/hybrid'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  createMemoryResponse,
  resolveMemoryWriteSecretProvenance,
} from '@/app/api/memory/secret-provenance'

function privateMemoryWrite(
  scope: { userId: string; workspaceId?: string },
  entries: Array<{ name: string; encryptedValue: string }> = []
) {
  const payload = {
    [PRIVATE_SECRET_PROVENANCE_FIELD]: {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'data',
          provenance: { version: 1 as const, complete: true, entries, scope },
        },
      ],
    },
  }
  const request = new NextRequest('http://localhost/api/memory', {
    method: 'POST',
    headers: { [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 },
    body: JSON.stringify(payload),
  })
  return { payload, request }
}

describe('memory write secret provenance', () => {
  beforeEach(() => {
    resetDbChainMock()
  })
  it('classifies a headerless external write as exact-empty', () => {
    const request = new NextRequest('http://localhost/api/memory', { method: 'POST' })
    const result = resolveMemoryWriteSecretProvenance({
      request,
      payload: {},
      authType: AuthType.SESSION,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result).toEqual({
      success: true,
      provenance: { status: 'exact', entries: [] },
    })
  })

  it('keeps a headerless internal write on the legacy untracked path', () => {
    const request = new NextRequest('http://localhost/api/memory', { method: 'POST' })
    const result = resolveMemoryWriteSecretProvenance({
      request,
      payload: {},
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result).toEqual({ success: true })
  })

  it('persists authenticated unavailable selection lineage as unknown', () => {
    const bundle = {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'data',
          provenance: {
            version: 1 as const,
            complete: false,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      ],
    }
    const payload = { [PRIVATE_SECRET_PROVENANCE_FIELD]: bundle }
    const request = new NextRequest('http://localhost/api/memory', {
      method: 'POST',
      headers: { [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 },
      body: JSON.stringify(payload),
    })

    const result = resolveMemoryWriteSecretProvenance({
      request,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result).toEqual({ success: true, provenance: { status: 'unknown' } })
  })

  it('persists an authenticated incomplete bundle as unknown', () => {
    const payload = {
      [PRIVATE_SECRET_PROVENANCE_FIELD]: {
        version: 1 as const,
        complete: false,
        selections: [],
      },
    }
    const request = new NextRequest('http://localhost/api/memory', {
      method: 'POST',
      headers: { [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 },
      body: JSON.stringify(payload),
    })

    expect(
      resolveMemoryWriteSecretProvenance({
        request,
        payload,
        authType: AuthType.INTERNAL_JWT,
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).toEqual({ success: true, provenance: { status: 'unknown' } })
  })

  it('accepts exact-empty provenance from the workflow owner in the actor workspace', () => {
    const { payload, request } = privateMemoryWrite({
      userId: 'workflow-owner',
      workspaceId: 'workspace-1',
    })

    expect(
      resolveMemoryWriteSecretProvenance({
        request,
        payload,
        authType: AuthType.INTERNAL_JWT,
        userId: 'billing-actor',
        workspaceId: 'workspace-1',
      })
    ).toEqual({ success: true, provenance: { status: 'exact', entries: [] } })
  })

  it('preserves the workflow owner as the source of same-workspace provenance', () => {
    const { payload, request } = privateMemoryWrite(
      { userId: 'workflow-owner', workspaceId: 'workspace-1' },
      [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }]
    )

    expect(
      resolveMemoryWriteSecretProvenance({
        request,
        payload,
        authType: AuthType.INTERNAL_JWT,
        userId: 'billing-actor',
        workspaceId: 'workspace-1',
      })
    ).toEqual({
      success: true,
      provenance: {
        status: 'exact',
        entries: [
          {
            name: 'TOKEN',
            encryptedValue: 'encrypted-token',
            sourceUserId: 'workflow-owner',
            sourceWorkspaceId: 'workspace-1',
          },
        ],
      },
    })
  })

  it('rejects provenance from another workspace', () => {
    const { payload, request } = privateMemoryWrite({
      userId: 'workflow-owner',
      workspaceId: 'workspace-2',
    })
    const result = resolveMemoryWriteSecretProvenance({
      request,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'billing-actor',
      workspaceId: 'workspace-1',
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(400)
  })

  it('bounds only requested private response provenance without querying sidecars', async () => {
    const request = new NextRequest('http://localhost/api/memory', {
      headers: {
        [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      },
    })
    const response = await createMemoryResponse({
      request,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      body: { success: true },
      memories: Array.from({ length: 10_001 }, (_, index) => ({
        id: `memory-${index}`,
        data: { value: index },
        secretProvenanceVersion: null,
      })),
    })

    await expect(response.json()).resolves.toMatchObject({
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: false, entries: [] },
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('marks oversized aggregate sidecar provenance incomplete before importing it', async () => {
    queueTableRows(memorySecretProvenance, [
      {
        memoryId: 'memory-1',
        contentHash: 'irrelevant-after-budget-check',
        status: 'exact',
        entries: Array.from({ length: 10_001 }, (_, index) => ({
          name: `SECRET_${index}`,
          encryptedValue: `encrypted-${index}`,
        })),
        updatedAt: new Date(),
      },
    ])
    const request = new NextRequest('http://localhost/api/memory', {
      headers: {
        [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      },
    })
    const response = await createMemoryResponse({
      request,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      body: { success: true, memories: [{ id: 'memory-1', data: 'value' }] },
      memories: [{ id: 'memory-1', data: 'value', secretProvenanceVersion: 1 }],
    })

    await expect(response.json()).resolves.toMatchObject({
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: false, entries: [] },
    })
  })
})
