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
} from '@/app/api/knowledge/secret-provenance'

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

describe('knowledge write secret provenance', () => {
  it('classifies a headerless external chunk write as exact-empty', () => {
    const payload = { content: 'manual content' }

    const result = resolveKnowledgeWriteSecretProvenance({
      request: createHeaderlessRequest(payload),
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
      request: createHeaderlessRequest(payload),
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
      request: createHeaderlessRequest(payload),
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['chunk-content'],
    })

    expect(result).toEqual({ success: true })
  })

  it('tracks exact-empty provenance only when an internal write supplies a verified envelope', () => {
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
    const payload = { content: 'workflow content', [PRIVATE_SECRET_PROVENANCE_FIELD]: bundle }

    const result = resolveKnowledgeWriteSecretProvenance({
      request: createRequest(payload),
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
      request: createRequest(payload),
      payload,
      authType: AuthType.API_KEY,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['chunk-content'],
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(400)
  })

  it('rejects an unavailable verified selection before a write can start', () => {
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
      request: createRequest(payload),
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      selectionKeys: ['document-source:0'],
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(400)
  })
})
