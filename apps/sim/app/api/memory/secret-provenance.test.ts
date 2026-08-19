/**
 * @vitest-environment node
 */

import { memorySecretProvenance } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnforced, mockReport } = vi.hoisted(() => ({
  mockIsEnforced: vi.fn(() => false),
  mockReport: vi.fn(),
}))

vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  DURABLE_SECRET_PROVENANCE_SURFACES: ['memory', 'table-row', 'knowledge'],
  isDurableSecretProvenanceEnforced: mockIsEnforced,
  reportUnrecordedDurableProvenance: mockReport,
}))

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
    mockReport.mockClear()
    mockIsEnforced.mockReturnValue(false)
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

  /**
   * A read of this width used to be refused outright on the record count alone. How many memories
   * crossed said nothing about whether their provenance could be established, so the read now
   * vouches for them and the page size is what keeps the statement count bounded.
   */
  it('vouches for a very wide crossing instead of refusing on the record count', async () => {
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
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
    })
    /** Eleven pages of a thousand, not one statement per handful of memories. */
    expect(dbChainMockFns.select.mock.calls.length).toBeLessThanOrEqual(11)
  })

  /**
   * A sidecar too large to carry reads as unrecorded, not as a reason to fail the read. The run
   * keeps its other provenance and proceeds without this memory's — best effort, with the risk
   * recorded — rather than refusing every projection for the rest of the run.
   */
  it('treats a sidecar too large to carry as unrecorded rather than failing the read', async () => {
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
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
    })
  })
  /**
   * One entry for the read, not one per record: the per-record import knows no workspace, so its
   * report can only ever be a log line, and passing the workspace down instead would write
   * thousands of audit rows for a single event.
   */
  it('reports one aggregated entry for a read that proceeded unvouched', async () => {
    const request = new NextRequest('http://localhost/api/memory', {
      headers: {
        [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      },
    })

    await createMemoryResponse({
      request,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      body: { success: true },
      memories: [
        { id: 'memory-1', data: 'value', secretProvenanceVersion: 1 },
        { id: 'memory-2', data: 'value', secretProvenanceVersion: 1 },
      ],
    })

    expect(mockReport).toHaveBeenCalledTimes(1)
    expect(mockReport).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'memory',
        cause: 'durable-provenance-unknown',
        affectedCount: 2,
        workspaceId: 'workspace-1',
      })
    )
  })

  /**
   * Under enforcement the import fails the registry closed rather than proceeding, so there is no
   * fail-open read to record. Counting those records anyway would audit something that never
   * happened, in the one trail whose whole purpose is to say a read went ahead unvouched.
   */
  it('records nothing when the surface is enforced and the read fails closed', async () => {
    mockIsEnforced.mockReturnValue(true)
    const request = new NextRequest('http://localhost/api/memory', {
      headers: {
        [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      },
    })

    await createMemoryResponse({
      request,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      body: { success: true },
      memories: [{ id: 'memory-1', data: 'value', secretProvenanceVersion: 1 }],
    })

    expect(mockReport).not.toHaveBeenCalled()
  })
})
