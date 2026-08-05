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
import { resolveKnowledgeWriteSecretProvenance } from '@/app/api/knowledge/secret-provenance'

function createRequest(payload: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/knowledge/kb/documents', {
    method: 'POST',
    headers: { [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 },
    body: JSON.stringify(payload),
  })
}

describe('knowledge write secret provenance', () => {
  it('rejects an unavailable verified selection before a write can start', () => {
    const bundle = {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'document-source:0',
          provenance: { version: 1 as const, complete: false, entries: [] },
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
