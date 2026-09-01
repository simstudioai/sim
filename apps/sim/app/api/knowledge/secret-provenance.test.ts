/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { AuthType } from '@/lib/auth/hybrid'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
} from '@/lib/execution/private-tool-metadata'
import {
  resolveKnowledgeDocumentWriteSecretProvenance,
  resolveKnowledgeWriteSecretProvenance,
} from '@/lib/knowledge/api/secret-provenance'

const PRIVATE_PROVENANCE_SCOPE = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
} as const

function createRequest(
  payload: Record<string, unknown>,
  provenanceHeader = PRIVATE_SECRET_PROVENANCE_BUNDLE_V1
): NextRequest {
  return new NextRequest('http://localhost/api/knowledge/kb/documents', {
    method: 'POST',
    headers: { [PRIVATE_SECRET_PROVENANCE_HEADER]: provenanceHeader },
    body: JSON.stringify(payload),
  })
}

function createHeaderlessRequest(payload: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/knowledge/kb/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

function privateChunkPayload(
  scope: { userId: string; workspaceId?: string },
  entries: Array<{ name: string; encryptedValue: string }> = []
) {
  return {
    content: 'workflow content',
    [PRIVATE_SECRET_PROVENANCE_FIELD]: {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'chunk-content',
          provenance: { version: 1 as const, complete: true, entries, scope },
        },
      ],
    },
  }
}

describe('knowledge write secret provenance', () => {
  it('classifies a headerless external chunk write as exact-empty', () => {
    const payload = { content: 'manual content' }

    const result = resolveKnowledgeWriteSecretProvenance({
      headers: createHeaderlessRequest(payload).headers,
      payload,
      authType: AuthType.API_KEY,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['chunk-content'],
    })

    expect(result).toEqual({
      success: true,
      provenances: [{ status: 'exact', entries: [] }],
    })
  })

  it('classifies a headerless external document write as exact-empty', () => {
    const payload = {
      filename: 'manual.txt',
    }

    const result = resolveKnowledgeDocumentWriteSecretProvenance({
      headers: createHeaderlessRequest(payload).headers,
      payload,
      authType: AuthType.SESSION,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      documents: [payload],
    })

    expect(result).toEqual({
      success: true,
      provenances: [
        {
          filename: { status: 'exact', entries: [] },
          content: { status: 'exact', entries: [] },
          tags: [],
        },
      ],
    })
  })

  it('does not track durable provenance for a legacy headerless internal write', () => {
    const payload = { content: 'legacy workflow content' }

    const result = resolveKnowledgeWriteSecretProvenance({
      headers: createHeaderlessRequest(payload).headers,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['chunk-content'],
    })

    expect(result).toEqual({ success: true })
  })

  it('tracks exact-empty provenance only when an internal write supplies a verified envelope', () => {
    const payload = privateChunkPayload(PRIVATE_PROVENANCE_SCOPE)

    const result = resolveKnowledgeWriteSecretProvenance({
      headers: createRequest(payload).headers,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['chunk-content'],
    })

    expect(result).toEqual({
      success: true,
      provenances: [{ status: 'exact', entries: [] }],
    })
  })

  it('accepts a different provenance source user in the destination workspace', () => {
    const payload = privateChunkPayload({ userId: 'workflow-owner', workspaceId: 'workspace-1' }, [
      { name: 'TOKEN', encryptedValue: 'encrypted-token' },
    ])

    expect(
      resolveKnowledgeWriteSecretProvenance({
        headers: createRequest(payload).headers,
        payload,
        authType: AuthType.INTERNAL_JWT,
        userId: 'billing-actor',
        workspaceId: 'workspace-1',
        selectionKeys: ['chunk-content'],
      })
    ).toEqual({
      success: true,
      provenances: [
        {
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
      ],
    })
  })

  it('rejects provenance from another workspace', () => {
    const payload = privateChunkPayload({
      userId: 'workflow-owner',
      workspaceId: 'workspace-2',
    })
    const result = resolveKnowledgeWriteSecretProvenance({
      headers: createRequest(payload).headers,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'billing-actor',
      workspaceId: 'workspace-1',
      selectionKeys: ['chunk-content'],
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(400)
  })

  it('keeps workspace-less knowledge writes isolated to the authenticated user', () => {
    const payload = privateChunkPayload({ userId: 'workflow-owner' })
    const result = resolveKnowledgeWriteSecretProvenance({
      headers: createRequest(payload).headers,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'billing-actor',
      selectionKeys: ['chunk-content'],
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(400)
  })

  it('rejects a private provenance envelope from an external caller', () => {
    const bundle = {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'chunk-content',
          provenance: {
            version: 1 as const,
            complete: true,
            entries: [],
            scope: PRIVATE_PROVENANCE_SCOPE,
          },
        },
      ],
    }
    const payload = { content: 'external content', [PRIVATE_SECRET_PROVENANCE_FIELD]: bundle }

    const result = resolveKnowledgeWriteSecretProvenance({
      headers: createRequest(payload).headers,
      payload,
      authType: AuthType.API_KEY,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['chunk-content'],
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(400)
  })

  it('persists authenticated unavailable selection lineage as unknown', () => {
    const bundle = {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'document-source:0',
          provenance: {
            version: 1 as const,
            complete: false,
            entries: [],
            scope: PRIVATE_PROVENANCE_SCOPE,
          },
        },
      ],
    }
    const payload = { [PRIVATE_SECRET_PROVENANCE_FIELD]: bundle }

    const result = resolveKnowledgeWriteSecretProvenance({
      headers: createRequest(payload).headers,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['document-source:0'],
    })

    expect(result).toEqual({ success: true, provenances: [{ status: 'unknown' }] })
  })

  it('persists an authenticated incomplete document bundle as unknown', () => {
    const payload = {
      [PRIVATE_SECRET_PROVENANCE_FIELD]: {
        version: 1 as const,
        complete: false,
        selections: [],
      },
    }

    const result = resolveKnowledgeDocumentWriteSecretProvenance({
      headers: createRequest(payload).headers,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      documents: [{ documentTagsData: JSON.stringify([{ tagName: 'region', value: 'west' }]) }],
    })

    expect(result).toEqual({
      success: true,
      provenances: [
        {
          filename: { status: 'unknown' },
          content: { status: 'unknown' },
          tags: [{ tagName: 'region', provenance: { status: 'unknown' } }],
        },
      ],
    })
  })

  it('keeps persisted tag names raw while retaining tag-value provenance', () => {
    const documentTagsData = JSON.stringify([{ tagName: 'private-name', value: 'west' }])
    const payload = {
      documents: [{ filename: 'doc.md', documentTagsData }],
      [PRIVATE_SECRET_PROVENANCE_FIELD]: {
        version: 1 as const,
        complete: true,
        selections: [
          {
            key: 'document-filename:0',
            provenance: {
              version: 1 as const,
              complete: true,
              entries: [],
              scope: PRIVATE_PROVENANCE_SCOPE,
            },
          },
          {
            key: 'document-content:0',
            provenance: {
              version: 1 as const,
              complete: true,
              entries: [],
              scope: PRIVATE_PROVENANCE_SCOPE,
            },
          },
          {
            key: 'document-tag-value:0:0',
            provenance: {
              version: 1 as const,
              complete: true,
              entries: [{ name: 'TAG_VALUE', encryptedValue: 'encrypted-tag-value' }],
              scope: PRIVATE_PROVENANCE_SCOPE,
            },
          },
        ],
      },
    }

    const result = resolveKnowledgeDocumentWriteSecretProvenance({
      headers: createRequest(payload).headers,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      documents: [{ documentTagsData }],
    })

    expect(result).toEqual({
      success: true,
      provenances: [
        {
          filename: { status: 'exact', entries: [] },
          content: { status: 'exact', entries: [] },
          tags: [
            {
              tagName: 'private-name',
              provenance: {
                status: 'exact',
                entries: [
                  {
                    name: 'TAG_VALUE',
                    encryptedValue: 'encrypted-tag-value',
                    sourceUserId: 'user-1',
                    sourceWorkspaceId: 'workspace-1',
                  },
                ],
              },
            },
          ],
        },
      ],
    })
  })
})
