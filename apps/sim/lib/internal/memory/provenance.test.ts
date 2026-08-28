/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
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
  readMemoryWriteProvenance,
} from '@/lib/internal/memory/provenance'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'billing-actor',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:memory',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

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
    expect(readMemoryWriteProvenance(new Headers(), {}, PRINCIPAL)).toBeUndefined()
  })

  it('binds authenticated provenance to the canonical workspace and preserves its source owner', () => {
    const headers = new Headers({
      [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
    })

    expect(
      readMemoryWriteProvenance(headers, privateWritePayload('workspace-1'), PRINCIPAL)
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
      readMemoryWriteProvenance(headers, privateWritePayload('workspace-2'), PRINCIPAL)
    ).toThrow(MemoryProvenanceError)
  })

  it('negotiates and serializes the private response envelope without exposing metadata by default', async () => {
    expect(memoryToolRequestsProvenance(new Headers())).toBe(false)
    const requestedHeaders = new Headers({
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    expect(memoryToolRequestsProvenance(requestedHeaders)).toBe(true)

    const body = { success: true, data: { memories: [] } }
    const ordinary = await createMemoryToolResponse(body, undefined, PRINCIPAL)
    expect(await ordinary.json()).toEqual(body)

    const privateResponse = await createMemoryToolResponse(
      body,
      [{ data: [], provenance: { status: 'exact', entries: [] } }],
      PRINCIPAL
    )
    expect(await privateResponse.json()).toMatchObject({
      ...body,
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
    })
  })
})
