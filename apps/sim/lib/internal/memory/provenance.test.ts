/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  createMemoryToolResponse,
  MemoryProvenanceError,
  memoryToolRequestsProvenance,
  memoryToolSuppliesWriteProvenance,
  readMemoryWriteProvenance,
} from '@/lib/internal/memory/provenance'

const PROVENANCE_SCOPE = { userId: 'billing-owner', workspaceId: 'workspace-1' }

function privateWritePayload(workspaceId: string) {
  return {
    [PRIVATE_SECRET_PROVENANCE_FIELD]: {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'data',
          provenance: {
            version: 1 as const,
            complete: true,
            entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
            scope: { userId: 'workflow-owner', workspaceId },
          },
        },
      ],
    },
  }
}

describe('Memory direct provenance', () => {
  it('keeps unsupported headerless executor writes on the legacy untracked path', () => {
    expect(memoryToolSuppliesWriteProvenance(new Headers(), {})).toBe(false)
    expect(readMemoryWriteProvenance(new Headers(), {}, PROVENANCE_SCOPE)).toBeUndefined()
  })

  it('binds authenticated provenance to the canonical workspace and preserves its source owner', () => {
    const headers = new Headers({
      [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
    })
    expect(memoryToolSuppliesWriteProvenance(headers, privateWritePayload('workspace-1'))).toBe(
      true
    )

    expect(
      readMemoryWriteProvenance(headers, privateWritePayload('workspace-1'), PROVENANCE_SCOPE)
    ).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'TOKEN',
          encryptedValue: 'encrypted-token',
          sourceUserId: 'workflow-owner',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
    expect(() =>
      readMemoryWriteProvenance(headers, privateWritePayload('workspace-2'), PROVENANCE_SCOPE)
    ).toThrow(MemoryProvenanceError)
  })

  it('negotiates and serializes the private response envelope without exposing metadata by default', async () => {
    expect(memoryToolRequestsProvenance(new Headers())).toBe(false)
    const requestedHeaders = new Headers({
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    expect(memoryToolRequestsProvenance(requestedHeaders)).toBe(true)

    const body = { success: true, data: { memories: [] } }
    const ordinary = await createMemoryToolResponse(body, undefined, undefined)
    expect(await ordinary.json()).toEqual(body)

    const privateResponse = await createMemoryToolResponse(
      body,
      [{ data: [], provenance: { status: 'exact', entries: [] } }],
      PROVENANCE_SCOPE
    )
    expect(await privateResponse.json()).toMatchObject({
      ...body,
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
    })
  })
})
