/**
 * @vitest-environment node
 */

import { memory } from '@sim/db/schema'
import {
  createMockRequest,
  dbChainMockFns,
  hybridAuthMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthType } from '@/lib/auth/hybrid'
import {
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const { mockCheckWorkspaceAccess, mockReplaceMemorySecretProvenanceInTx } = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockReplaceMemorySecretProvenanceInTx: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/memory/secret-provenance', () => ({
  readBoundMemorySecretProvenance: vi.fn(() => ({ status: 'unknown' })),
  replaceMemorySecretProvenanceInTx: mockReplaceMemorySecretProvenanceInTx,
}))

import { GET, PUT } from '@/app/api/memory/[id]/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const CONTEXT = { params: Promise.resolve({ id: 'missing-conversation' }) }

describe('GET /api/memory/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: AuthType.INTERNAL_JWT,
    })
    mockCheckWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
    queueTableRows(memory, [])
  })

  it('returns verified exact-empty metadata when a tool lookup has no matching memory', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {
          [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        },
        `http://localhost:3000/api/memory/missing-conversation?workspaceId=${WORKSPACE_ID}`
      ),
      CONTEXT
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(PRIVATE_TOOL_METADATA_RESPONSE_HEADER)).toBe(
      RESOLVED_SECRET_PROVENANCE_METADATA_V1
    )
    expect(await response.json()).toEqual({
      success: true,
      data: null,
      [RESOLVED_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        entries: [],
        scope: { userId: 'user-1', workspaceId: WORKSPACE_ID },
      },
    })
  })

  it('preserves the existing headerless empty response for ordinary API callers', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost:3000/api/memory/missing-conversation?workspaceId=${WORKSPACE_ID}`
      ),
      CONTEXT
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(PRIVATE_TOOL_METADATA_RESPONSE_HEADER)).toBeNull()
    expect(await response.json()).toEqual({ success: true, data: null })
  })
})

describe('PUT /api/memory/[id]', () => {
  const CONVERSATION_ID = 'conversation-1'
  const PUT_CONTEXT = { params: Promise.resolve({ id: CONVERSATION_ID }) }
  const MESSAGE = { role: 'user', content: 'hi' } as const

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: AuthType.API_KEY,
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
    })
    mockReplaceMemorySecretProvenanceInTx.mockResolvedValue(undefined)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'memory-row-1' }])
    queueTableRows(memory, [
      { id: 'memory-row-1', key: CONVERSATION_ID, data: [], secretProvenanceVersion: null },
    ])
    queueTableRows(memory, [
      { id: 'memory-row-1', key: CONVERSATION_ID, data: [MESSAGE], secretProvenanceVersion: 1 },
    ])
  })

  it('persists the updated message wrapped in an array so reads keep the POST-written shape', async () => {
    const response = await PUT(
      createMockRequest(
        'PUT',
        { data: MESSAGE, workspaceId: WORKSPACE_ID },
        {},
        `http://localhost:3000/api/memory/${CONVERSATION_ID}`
      ),
      PUT_CONTEXT
    )

    expect(response.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ role: 'user', content: 'hi' }] })
    )
  })

  it('hashes provenance over the exact persisted value', async () => {
    await PUT(
      createMockRequest(
        'PUT',
        { data: MESSAGE, workspaceId: WORKSPACE_ID },
        {},
        `http://localhost:3000/api/memory/${CONVERSATION_ID}`
      ),
      PUT_CONTEXT
    )

    expect(mockReplaceMemorySecretProvenanceInTx).toHaveBeenCalledWith(
      expect.anything(),
      'memory-row-1',
      [{ role: 'user', content: 'hi' }],
      expect.anything()
    )
    const [setPayload] = dbChainMockFns.set.mock.calls[0] as [{ data: unknown }]
    const [, , provenanceValue] = mockReplaceMemorySecretProvenanceInTx.mock.calls[0]
    expect(provenanceValue).toBe(setPayload.data)
  })
})
