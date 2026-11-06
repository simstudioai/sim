/** In-process v2 callers (Chat's CLI, MCP) carry no network origin, yet their upload transfers must still be signed. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import { apiKey, auditLog, organization, uploadSession, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { rateLimiterMock } from '@sim/testing/mocks/rate-limiter.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

import { dispatchMcpOperation } from '@/lib/api/mcp/dispatch'
import type { V2McpOperationName } from '@/lib/api/mcp/generated/v2-operations'
import { generateApiKey, hashApiKey } from '@/lib/api-key/crypto'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import '@/app/api/v2/files/uploads/route'
import '@/app/api/v2/files/uploads/[uploadId]/parts/route'
import '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/route'
import '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts/route'
import '@/app/api/v2/tables/imports/route'
import '@/app/api/v2/tables/imports/[importId]/parts/route'

/** Deliberately not the public app URL: the CLI can only reach the origin it was configured with. */
const CLI_ENDPOINT = 'http://sim-internal.test:3400'
const MULTIPART_SIZE = 9 * 1024 * 1024
const PUT_SIZE = 64

type Fixture = ReturnType<typeof createKnowledgeAclFixtureIds> & { personalKey: string }

/** One POST to a v2 route, addressed both as a path (CLI) and as an MCP operation with path params. */
interface TransferCall {
  operation: V2McpOperationName
  path: string
  params: Record<string, string>
  query?: Record<string, string>
  headers?: Record<string, string>
  body: unknown
}

interface UploadTarget {
  name: string
  create: (fixture: Fixture, size: number) => TransferCall
  partsOperation: V2McpOperationName
  partsPath: (
    fixture: Fixture,
    uploadId: string
  ) => { path: string; params: Record<string, string> }
}

/** The fields every v2 upload create (`session`, `uploadToken`, `transfer`) and parts (`parts`) response shares. */
interface TransferData {
  session: { id: string }
  uploadToken: string
  transfer: { method: string; url?: string }
  parts: { partNumber: number; url: string }[]
}

const TARGETS: UploadTarget[] = [
  {
    name: 'knowledge document',
    create: (fixture, size) => ({
      operation: 'createKnowledgeDocumentUpload',
      path: `/api/v2/knowledge/${fixture.knowledgeBaseId}/documents/uploads`,
      params: { knowledgeBaseId: fixture.knowledgeBaseId },
      body: {
        workspaceId: fixture.workspaceId,
        name: 'notes.txt',
        contentType: 'text/plain',
        size,
      },
    }),
    partsOperation: 'createKnowledgeDocumentUploadPartUrls',
    partsPath: (fixture, uploadId) => ({
      path: `/api/v2/knowledge/${fixture.knowledgeBaseId}/documents/uploads/${uploadId}/parts`,
      params: { knowledgeBaseId: fixture.knowledgeBaseId, uploadId },
    }),
  },
  {
    name: 'table import',
    create: (fixture, size) => ({
      operation: 'createTableImport',
      path: '/api/v2/tables/imports',
      params: {},
      body: {
        workspaceId: fixture.workspaceId,
        source: { type: 'upload', name: 'rows.csv', contentType: 'text/csv', size },
        target: { type: 'new', name: `import_${generateId().slice(0, 8)}` },
      },
    }),
    partsOperation: 'createTableImportPartUrls',
    partsPath: (_fixture, uploadId) => ({
      path: `/api/v2/tables/imports/${uploadId}/parts`,
      params: { importId: uploadId },
    }),
  },
  {
    name: 'workspace file',
    create: (fixture, size) => ({
      operation: 'createFileUpload',
      path: '/api/v2/files/uploads',
      params: {},
      body: {
        workspaceId: fixture.workspaceId,
        name: `archive-${generateId()}.bin`,
        contentType: 'application/octet-stream',
        size,
      },
    }),
    partsOperation: 'createFileUploadPartUrls',
    partsPath: (_fixture, uploadId) => ({
      path: `/api/v2/files/uploads/${uploadId}/parts`,
      params: { uploadId },
    }),
  },
]

function partsCall(
  fixture: Fixture,
  target: UploadTarget,
  uploadId: string,
  uploadToken: string
): TransferCall {
  return {
    operation: target.partsOperation,
    ...target.partsPath(fixture, uploadId),
    query: { workspaceId: fixture.workspaceId },
    headers: { 'upload-token': uploadToken },
    body: { partNumbers: [1, 2] },
  }
}

function parseData(text: string): TransferData {
  return JSON.parse(text).data
}

/** Chat's CLI: requests built from the configured endpoint, with no Host or Origin header. */
function viaCli(fixture: Fixture) {
  const transport = createScopedCliTransport(CLI_ENDPOINT, {
    userId: fixture.aliceId,
    workspaceId: fixture.workspaceId,
    chatId: generateId(),
  })
  return async (call: TransferCall) => {
    const url = new URL(call.path, CLI_ENDPOINT)
    for (const [name, value] of Object.entries(call.query ?? {})) url.searchParams.set(name, value)
    const response = await withWorkspaceInvocationScope(
      { workspaceId: fixture.workspaceId, organizationId: fixture.organizationId },
      () =>
        transport(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...call.headers },
          body: JSON.stringify(call.body),
        })
    )
    const text = await response.text()
    expect(response.ok, text).toBe(true)
    return parseData(text)
  }
}

/** The MCP server: one tool call dispatched to the owning v2 route under the caller's API key; only the client address is inherited. */
function viaMcp(fixture: Fixture) {
  return async (call: TransferCall) => {
    const result = await dispatchMcpOperation(
      {
        operation: call.operation,
        params: call.params,
        ...(call.query ? { query: call.query } : {}),
        ...(call.headers ? { headers: call.headers } : {}),
        body: call.body,
      },
      {
        inbound: new NextRequest('https://mcp.sim.test/api/mcp', {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.7' },
        }),
        credential: { apiKey: fixture.personalKey, bearer: null },
        audience: {},
        signal: new AbortController().signal,
      }
    )
    const content = result.content[0]
    const text = content?.type === 'text' ? content.text : ''
    expect(result.isError, text).toBeFalsy()
    return parseData(text)
  }
}

const SURFACES = [
  { name: 'the CLI at its own endpoint', origin: () => CLI_ENDPOINT, caller: viaCli },
  { name: 'MCP at the public app URL', origin: getBaseUrl, caller: viaMcp },
]

describe('upload signing for in-process v2 callers on local storage', () => {
  const ids = createKnowledgeAclFixtureIds()
  const fixture: Fixture = { ...ids, personalKey: generateApiKey() }
  let storageRoot = ''

  beforeAll(async () => {
    storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-in-process-upload-origin-'))
    setUploadDirServer(storageRoot)
    await seedKnowledgeAclFixture(ids)
    await db.insert(apiKey).values({
      id: generateId(),
      userId: ids.aliceId,
      name: 'MCP fixture',
      key: fixture.personalKey,
      keyHash: hashApiKey(fixture.personalKey),
      type: 'personal',
    })
  })

  afterAll(async () => {
    await db.delete(uploadSession).where(eq(uploadSession.workspaceId, ids.workspaceId))
    await db.delete(apiKey).where(eq(apiKey.userId, ids.aliceId))
    await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(storageRoot, { recursive: true, force: true })
  })

  for (const target of TARGETS) {
    for (const surface of SURFACES) {
      it(`signs ${target.name} single-PUT and multipart transfers for ${surface.name}`, async () => {
        const call = surface.caller(fixture)
        const origin = surface.origin()

        const put = await call(target.create(fixture, PUT_SIZE))
        expect(put.transfer).toMatchObject({
          method: 'put',
          url: `${origin}/api/v2/uploads/${put.session.id}`,
        })

        const multipart = await call(target.create(fixture, MULTIPART_SIZE))
        expect(multipart.transfer.method).toBe('multipart')
        const uploadId = multipart.session.id
        const { parts } = await call(partsCall(fixture, target, uploadId, multipart.uploadToken))
        expect(parts.map((part) => part.url)).toEqual(
          [1, 2].map((partNumber) =>
            expect.stringMatching(
              new RegExp(`^${origin}/api/v2/uploads/${uploadId}/parts/${partNumber}\\?token=`)
            )
          )
        )
      })
    }
  }
})
