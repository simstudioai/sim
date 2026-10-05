/** Real Function file exports, ZIP extraction, durable provenance, and KB indexing. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as audit from '@sim/audit'
import { db } from '@sim/db'
import {
  auditLog,
  document,
  documentSecretProvenance,
  knowledgeBase,
  organization,
  outboxEvent,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { remoteSandboxMock, remoteSandboxMockFns } from '@sim/testing/mocks/remote-sandbox.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
const sandboxEnvironment = vi.hoisted(() => {
  const fixture = {
    SANDBOX_PROVIDER: 'e2b',
    E2B_ENABLED: 'true',
    E2B_API_KEY: 'integration-provider-fixture-not-a-real-key',
    E2B_FUNCTION_TEMPLATE_ID: 'fixture:11111111-1111-4111-8111-111111111111',
    E2B_FUNCTION_TEMPLATE_GENERATION: '1785792000000',
  }
  const previous = Object.entries(fixture).map(([key]) => [key, process.env[key]] as const)
  Object.assign(process.env, fixture)
  return previous
})
vi.mock('@/lib/execution/remote-sandbox', () => remoteSandboxMock)
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))

import { functionExecuteBodySchema } from '@/lib/api/contracts'
import { fileManageDecompressBodySchema } from '@/lib/api/contracts/tools/file'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { isUserFile } from '@/lib/core/utils/user-file'
import {
  MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_NAMES_FIELD,
  RESOLVED_SECRET_NAMES_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { executeFunctionRequest } from '@/lib/function-execution/execute-request'
import { executeFileManageOperation } from '@/lib/internal/file/operations'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { addWorkspaceFilesToKnowledgeBase } from '@/lib/knowledge/application/add-workspace-files'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-outbox-event'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { createSingleDocument } from '@/lib/knowledge/documents/service'
import { loadKnowledgeDocumentSecretRegistry } from '@/lib/knowledge/secret-provenance'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-manager'
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  filterModelSafeWorkspaceFileAttachments,
  getBoundWorkspaceFileSecretProvenance,
  importWorkspaceFileSecretProvenanceForRuntime,
  isModelSafeWorkspaceFileKey,
  isOpaqueWorkspaceFileEgressSafe,
  type WorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { deleteFile, downloadFile } from '@/lib/uploads/core/storage-service'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import type { UserFile } from '@/executor/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const trackedEventIds: string[] = []
const fixtureAuditCounts = new Map<string, number>()
let restoreAuditObservation: (() => void) | undefined
const REPORT_TEXT =
  'Orion archive import retains verified source bytes through every durable surface.'
const REPORT_CSV = `name,description\nOrion,${REPORT_TEXT}\n`
const FIXTURE_SECRET = 'fixture-resolved-secret-not-a-live-key'

async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  fixtureAuditCounts.set(ids.workspaceId, 0)
  await seedKnowledgeAclFixture(ids)
  return { ...ids, workflowId: generateId(), executionId: generateId() }
}

type Fixture = Awaited<ReturnType<typeof seed>>

function sessionPrincipal(ids: Fixture) {
  return { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-session' } as const
}

async function uploadArchive(
  ids: Fixture,
  provenance?: WorkspaceFileSecretProvenance,
  content = REPORT_CSV
) {
  const zip = new JSZip()
  zip.file('report.csv', content)
  return uploadExecutionFile(
    ids,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    'report.zip',
    'application/zip',
    ids.aliceId,
    provenance
  )
}

async function decompress(ids: Fixture, archive: UserFile, executionId = ids.executionId) {
  return executeFileManageOperation(
    fileManageDecompressBodySchema.parse({
      operation: 'decompress',
      workspaceId: ids.workspaceId,
      fileInput: archive,
    }),
    {
      principal: createWorkspaceFileDelegatedPrincipal({
        serviceId: 'executor',
        subjectUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
        delegationId: generateId(),
        executionId,
      }),
      workspaceId: ids.workspaceId,
      attributedUserId: ids.aliceId,
      fileAccessUserId: ids.aliceId,
      workflowId: ids.workflowId,
      executionId,
      headers: new Headers(),
      requestId: generateId(),
    }
  )
}

async function extract(ids: Fixture, archive: UserFile) {
  const response = await decompress(ids, archive)
  const body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  expect(body.success).toBe(true)
  const candidates: unknown = body.data?.files
  if (!Array.isArray(candidates) || !candidates.every(isUserFile)) {
    throw new Error('Archive extraction returned invalid file metadata')
  }
  expect(candidates).toHaveLength(1)
  const child = candidates[0]
  const record = await getWorkspaceFile(ids.workspaceId, child.id)
  if (!record) throw new Error('Extracted file has no canonical workspace record')
  const identity = {
    fileId: record.id,
    key: record.key,
    context: 'workspace' as const,
    contentUpdatedAt: record.contentUpdatedAt ?? undefined,
  }
  return { child, record, identity, publicMetadata: JSON.stringify({ archive, body }) }
}

async function assertBlockedConsumers(ids: Fixture, source: Awaited<ReturnType<typeof extract>>) {
  expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, source.identity)).toBe(false)
  const imported = await addWorkspaceFilesToKnowledgeBase.execute({
    principal: sessionPrincipal(ids),
    input: { knowledgeBaseId: ids.knowledgeBaseId, fileReferences: [source.child.id] },
  })
  expect(imported).toMatchObject({ added: [], failed: [source.child.id] })
}

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-execution-archive-provenance-'))
  const observe = (entry: audit.AuditLogParams) => {
    if (!entry.workspaceId) return
    const count = fixtureAuditCounts.get(entry.workspaceId)
    if (count !== undefined) fixtureAuditCounts.set(entry.workspaceId, count + 1)
  }
  const recordAudit = audit.recordAudit
  const recordAuditBatch = audit.recordAuditBatch
  const observation = vi.spyOn(audit, 'recordAudit').mockImplementation((entry) => {
    observe(entry)
    recordAudit(entry)
  })
  const batchObservation = vi.spyOn(audit, 'recordAuditBatch').mockImplementation((entries) => {
    for (const entry of entries) observe(entry)
    recordAuditBatch(entries)
  })
  restoreAuditObservation = () => {
    observation.mockRestore()
    batchObservation.mockRestore()
  }
})
afterAll(async () => {
  try {
    /** Drain actual asynchronous inserts before deleting fixture ownership rows. */
    for (const [workspaceId, expected] of fixtureAuditCounts) {
      await vi.waitFor(async () =>
        expect(
          await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId))
        ).toHaveLength(expected)
      )
    }
  } finally {
    restoreAuditObservation?.()
    try {
      if (trackedEventIds.length) {
        await db.delete(outboxEvent).where(inArray(outboxEvent.id, trackedEventIds))
      }
      for (const ids of fixtures) {
        await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
        await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
        await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
        await db.delete(organization).where(eq(organization.id, ids.organizationId))
        await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
      }
      await rm(fixtureStorage.root, { recursive: true, force: true })
    } finally {
      for (const [key, value] of sandboxEnvironment) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      await db.$client.end()
    }
  }
})

async function executeFunction(
  ids: Fixture,
  body: Record<string, unknown>,
  headers = new Headers(),
  registry = new ResolvedSecretTraceRegistry([], {
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
  })
) {
  return executeFunctionRequest(
    { headers, signal: AbortSignal.timeout(15_000) },
    functionExecuteBodySchema.parse({
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      executionId: ids.executionId,
      language: 'python',
      ...body,
    }),
    {
      attributedUserId: ids.aliceId,
      fileAccessUserId: ids.aliceId,
      principal: createWorkspaceFileDelegatedPrincipal({
        serviceId: 'executor',
        subjectUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
        delegationId: generateId(),
        executionId: ids.executionId,
      }),
      resolvedSecretTraceRegistry: registry,
    }
  )
}

async function readFunctionFile(ids: Fixture, fileId: string) {
  const [record] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, fileId))
  if (!record || record.workspaceId !== ids.workspaceId) {
    throw new Error('Function export has no canonical record in its workspace')
  }
  if (record.context !== 'workspace' && record.context !== 'execution') {
    throw new Error('Function export has an unexpected storage context')
  }
  const identity: WorkspaceFileSecretProvenanceIdentity = {
    fileId: record.id,
    key: record.key,
    context: record.context,
    contentUpdatedAt: record.contentUpdatedAt,
  }
  const provenance = await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, identity)
  const bytes = await downloadFile({ key: record.key, context: record.context, maxBytes: 8192 })
  const registry = new ResolvedSecretTraceRegistry([], {
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
  })
  const imported = await importWorkspaceFileSecretProvenanceForRuntime({
    workspaceId: ids.workspaceId,
    identity,
    registry,
  })
  return { identity, provenance, bytes, registry, imported }
}

async function readArchiveReport(bytes: Buffer): Promise<string> {
  const archive = await JSZip.loadAsync(bytes)
  const report = archive.file('report.txt')
  if (!report) throw new Error('Stored archive is missing report.txt')
  return report.async('string')
}

/** The provider supplies bytes; Function classification, both writers and consumer admission stay real. */
describe('Function export provenance in PostgreSQL', () => {
  it.each([false, true])(
    'persists compiled binary candidates without broadening short or exempt values (protected=%s)',
    async (protectedValues) => {
      const ids = await seed()
      const boundary = 'eight888'
      const short = 'short77'
      const shortEscaped = '""""'
      const shortJson = JSON.stringify({ value: shortEscaped })
      const content = `${FIXTURE_SECRET}\n${boundary}\n${short}`
      const zip = new JSZip()
      zip.file('report.txt', content)
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      expect(bytes.includes(FIXTURE_SECRET)).toBe(false)
      remoteSandboxMockFns.mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'fixture',
        exportedFiles: {
          '/home/user/report.zip': bytes.toString('base64'),
          ...(protectedValues
            ? { '/home/user/narrow.txt': boundary, '/home/user/short.json': shortJson }
            : {}),
        },
      })
      const response = await executeFunction(
        ids,
        {
          code: `exempt = {{EXEMPT_KEY}}\nshort = {{SHORT}}\nshort_escaped = {{SHORT_ESCAPED}}${
            protectedValues ? '\nprotected = {{PROTECTED_KEY}}\nboundary = {{BOUNDARY}}' : ''
          }`,
          envVars: {
            EXEMPT_KEY: FIXTURE_SECRET,
            SHORT: short,
            SHORT_ESCAPED: shortEscaped,
            ...(protectedValues ? { PROTECTED_KEY: FIXTURE_SECRET, BOUNDARY: boundary } : {}),
          },
          unredactedSecretNames: ['EXEMPT_KEY'],
          outputs: {
            files: [
              {
                path: 'files/report.zip',
                sandboxPath: '/home/user/report.zip',
                mimeType: 'application/zip',
              },
              ...(protectedValues
                ? [
                    { path: 'files/narrow.txt', sandboxPath: '/home/user/narrow.txt' },
                    {
                      path: 'files/short.json',
                      sandboxPath: '/home/user/short.json',
                      mimeType: 'application/json',
                    },
                  ]
                : []),
            ],
          },
        },
        new Headers({ [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_NAMES_METADATA_V1 })
      )
      const body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(body[RESOLVED_SECRET_NAMES_FIELD].sort()).toEqual(
        protectedValues
          ? ['BOUNDARY', 'EXEMPT_KEY', 'PROTECTED_KEY', 'SHORT', 'SHORT_ESCAPED']
          : ['EXEMPT_KEY', 'SHORT', 'SHORT_ESCAPED']
      )
      expect(JSON.stringify(body)).not.toContain('encryptedValue')
      const exported = body.output.exported.files
      expect(exported).toHaveLength(protectedValues ? 3 : 1)
      const archive = await readFunctionFile(ids, exported[0].fileId)
      expect(archive.bytes).toEqual(bytes)
      expect(archive.provenance.status).toBe('exact')
      if (archive.provenance.status !== 'exact')
        throw new Error('Function export lost known lineage')
      const decrypted = await Promise.all(
        archive.provenance.entries.map(async (entry) => ({
          name: entry.name,
          value: (await decryptSecret(entry.encryptedValue)).decrypted,
        }))
      )
      expect(decrypted).toEqual(
        protectedValues
          ? [
              { name: 'BOUNDARY', value: boundary },
              { name: 'PROTECTED_KEY', value: FIXTURE_SECRET },
            ]
          : []
      )
      expect(archive.imported).toBe(true)
      const readback = await readArchiveReport(archive.bytes)
      expect(readback).toBe(content)
      expect(projectResolvedSecretModelContent(readback, archive.registry)).toMatchObject({
        safe: true,
        value: protectedValues ? `{{PROTECTED_KEY}}\n{{BOUNDARY}}\n${short}` : content,
      })
      expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, archive.identity)).toBe(
        !protectedValues
      )
      if (protectedValues) {
        const narrowed = await readFunctionFile(ids, exported[1].fileId)
        expect(narrowed.bytes.toString()).toBe(boundary)
        expect(narrowed.provenance).toMatchObject({
          status: 'exact',
          entries: [{ name: 'BOUNDARY' }],
        })
        expect(narrowed.imported).toBe(true)
        expect(
          projectResolvedSecretModelContent(narrowed.bytes.toString(), narrowed.registry)
        ).toMatchObject({
          safe: true,
          value: '{{BOUNDARY}}',
        })
        const shortOutput = await readFunctionFile(ids, exported[2].fileId)
        expect(shortOutput.bytes.toString()).toBe(shortJson)
        expect(shortOutput.provenance).toEqual({ status: 'exact', entries: [] })
        expect(shortOutput.imported).toBe(true)
        expect(
          projectResolvedSecretModelContent(shortOutput.bytes.toString(), shortOutput.registry)
        ).toMatchObject({ safe: true, value: shortJson })
      }
    }
  )

  it.each([
    { name: 'report.zip', compressed: true, known: true, absent: false },
    { name: 'report.txt', compressed: true, known: true, absent: false },
    { name: 'report.zip', compressed: false, known: true, absent: false },
    { name: 'report.zip', compressed: true, known: true, absent: true },
    { name: 'report.zip', compressed: true, known: false, absent: true },
  ])(
    'persists harvested $name lineage (compressed=$compressed, known=$known, absent=$absent)',
    async ({ name, compressed, known, absent }) => {
      const ids = await seed()
      const provenance: WorkspaceFileSecretProvenance = {
        status: 'exact',
        entries: [
          {
            name: 'MOUNT_TOKEN',
            encryptedValue: (await encryptSecret(FIXTURE_SECRET)).encrypted,
            sourceUserId: ids.aliceId,
            sourceWorkspaceId: ids.workspaceId,
          },
        ],
      }
      const input = await uploadExecutionFile(
        ids,
        Buffer.from(FIXTURE_SECRET),
        'input.txt',
        'text/plain',
        ids.aliceId,
        known ? provenance : undefined
      )
      const zip = new JSZip()
      zip.file('report.txt', FIXTURE_SECRET)
      const bytes = compressed
        ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
        : Buffer.from('Ordinary UTF-8 bytes declared as an archive')
      expect(bytes.includes(FIXTURE_SECRET)).toBe(false)
      remoteSandboxMockFns.mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'fixture',
        collectedFiles: [
          {
            relativePath: name,
            path: `/tmp/sim/outputs/${name}`,
            contentBase64: bytes.toString('base64'),
            byteLength: bytes.length,
          },
        ],
      })
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
      })
      if (absent) registry.markIncomplete('source-provenance-incomplete')
      const finishActivation = registry.beginPendingActivation()
      let response: Awaited<ReturnType<typeof executeFunction>>
      try {
        response = await executeFunction(
          ids,
          {
            code: 'print("done")',
            files: [input],
            fileKeys: [input.key],
          },
          new Headers(),
          registry
        )
      } finally {
        finishActivation()
      }
      const body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(body.output.files).toHaveLength(1)
      expect(JSON.stringify(body)).not.toContain('encryptedValue')
      const exported = await readFunctionFile(ids, body.output.files[0].id)
      expect(exported.identity.context).toBe('execution')
      expect(exported.bytes).toEqual(bytes)
      expect(exported.provenance).toEqual(known ? provenance : { status: 'unrecorded' })
      expect(exported.imported).toBe(true)
      const value = compressed ? await readArchiveReport(exported.bytes) : exported.bytes.toString()
      expect(projectResolvedSecretModelContent(value, exported.registry)).toMatchObject({
        safe: true,
        value: compressed ? (known ? '{{MOUNT_TOKEN}}' : FIXTURE_SECRET) : bytes.toString(),
      })
      expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, exported.identity)).toBe(!known)
    }
  )

  it.each([
    { input: 'params', unredacted: false },
    { input: 'contextVariables', unredacted: false },
    { input: 'contextVariables', unredacted: true },
  ] as const)(
    'persists runtime $input candidates with trusted exemption=$unredacted',
    async ({ input, unredacted }) => {
      const ids = await seed()
      const registry = new ResolvedSecretTraceRegistry(
        [
          {
            name: 'INPUT_TOKEN',
            plaintext: FIXTURE_SECRET,
            encryptedValue: (await encryptSecret(FIXTURE_SECRET)).encrypted,
            ...(unredacted ? { unredacted: true as const } : {}),
          },
        ],
        { userId: ids.aliceId, workspaceId: ids.workspaceId }
      )
      expect(
        registry.recordResolvedAtInputPath('INPUT_TOKEN', FIXTURE_SECRET, [input, 'token'])
      ).toBe(true)
      const zip = new JSZip()
      zip.file('report.txt', FIXTURE_SECRET)
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      remoteSandboxMockFns.mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'fixture',
        collectedFiles: [
          {
            relativePath: 'report.zip',
            path: '/tmp/sim/outputs/report.zip',
            contentBase64: bytes.toString('base64'),
            byteLength: bytes.length,
          },
        ],
      })
      const response = await executeFunction(
        ids,
        {
          code: input === 'params' ? 'value = params["token"]' : 'value = token',
          [input]: { token: FIXTURE_SECRET },
        },
        new Headers(),
        registry
      )
      const body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      const exported = await readFunctionFile(ids, body.output.files[0].id)
      expect(exported.bytes).toEqual(bytes)
      expect(exported.provenance).toMatchObject({
        status: 'exact',
        entries: unredacted ? [] : [{ name: 'INPUT_TOKEN' }],
      })
      expect(exported.imported).toBe(true)
      const readback = await readArchiveReport(exported.bytes)
      expect(projectResolvedSecretModelContent(readback, exported.registry)).toMatchObject({
        safe: true,
        value: unredacted ? FIXTURE_SECRET : '{{INPUT_TOKEN}}',
      })
      expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, exported.identity)).toBe(
        unredacted
      )
    }
  )

  it.each([
    { extension: 'txt', evidence: 'incomplete' },
    { extension: 'zip', evidence: 'incomplete' },
    { extension: 'zip', evidence: 'complete' },
    { extension: 'zip', evidence: 'corrupt' },
  ] as const)(
    'persists $evidence private mounted evidence for a declared $extension export',
    async ({ extension, evidence }) => {
      const ids = await seed()
      const { encrypted } = await encryptSecret(FIXTURE_SECRET)
      const encryptedValue =
        evidence === 'corrupt'
          ? `${encrypted.slice(0, -1)}${encrypted.endsWith('0') ? '1' : '0'}`
          : encrypted
      const zip = new JSZip()
      zip.file('report.txt', FIXTURE_SECRET)
      const bytes =
        extension === 'zip'
          ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
          : Buffer.from('ordinary output')
      expect(bytes.includes(FIXTURE_SECRET)).toBe(false)
      remoteSandboxMockFns.mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'fixture',
        exportedFiles: {
          [`/home/user/output.${extension}`]: bytes.toString(
            extension === 'zip' ? 'base64' : 'utf8'
          ),
        },
      })
      const response = await executeFunction(
        ids,
        {
          code: 'print("done")',
          outputs: {
            files: [
              { path: `files/output.${extension}`, sandboxPath: `/home/user/output.${extension}` },
            ],
          },
          [PRIVATE_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: evidence !== 'incomplete',
            selections:
              evidence === 'incomplete'
                ? []
                : [
                    {
                      key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
                      provenance: {
                        version: 1,
                        complete: true,
                        entries: [{ encryptedValue }],
                        scope: { userId: ids.aliceId, workspaceId: ids.workspaceId },
                      },
                    },
                  ],
          },
        },
        new Headers({ [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 })
      )
      const body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(JSON.stringify(body)).not.toContain(encryptedValue)
      const output = await readFunctionFile(ids, body.output.exported.files[0].fileId)
      expect(output.bytes).toEqual(bytes)
      expect(output.imported).toBe(evidence === 'complete')
      expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, output.identity)).toBe(false)
      if (evidence === 'complete') {
        expect(output.provenance).toEqual({
          status: 'exact',
          entries: [
            {
              name: 'MOUNTED_FILE_SECRET',
              encryptedValue,
              sourceUserId: ids.aliceId,
              sourceWorkspaceId: ids.workspaceId,
            },
          ],
        })
        const readback = await readArchiveReport(output.bytes)
        expect(readback).toBe(FIXTURE_SECRET)
        expect(projectResolvedSecretModelContent(readback, output.registry)).toMatchObject({
          safe: true,
          value: '{{MOUNTED_FILE_SECRET}}',
        })
      } else {
        expect(output.provenance).toEqual({ status: 'unknown' })
      }
    }
  )
})

describe('execution archive durable provenance', () => {
  it.each(['exact', 'unrecorded'] as const)(
    'carries %s lineage through extraction and delayed KB indexing/search',
    async (status) => {
      const ids = await seed()
      const provenance: WorkspaceFileSecretProvenance =
        status === 'exact' ? { status, entries: [] } : { status }
      const archive = await uploadArchive(ids, provenance)
      const [storedArchive] = await db
        .select({
          secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
          context: workspaceFiles.context,
        })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.key, archive.key))
      expect(storedArchive.secretProvenanceVersion).toBe(1)
      expect(storedArchive.context).toBe('execution')
      const source = await extract(ids, archive)
      expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, source.identity)).toEqual(
        provenance
      )
      expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, source.identity)).toBe(true)
      expect((await downloadFile({ key: source.child.key, context: 'workspace' })).toString()).toBe(
        REPORT_CSV
      )

      const imported = await addWorkspaceFilesToKnowledgeBase.execute({
        principal: sessionPrincipal(ids),
        input: { knowledgeBaseId: ids.knowledgeBaseId, fileReferences: [source.child.id] },
      })
      expect(imported.failed).toEqual([])
      expect(imported.added).toHaveLength(1)
      const documentId = imported.added[0].documentId
      const [admitted] = await db.select().from(document).where(eq(document.id, documentId))
      expect(admitted.secretProvenanceVersion).toBe(1)
      expect(admitted.storageKey).toMatch(/^kb\//)
      const events = await db
        .select()
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}::jsonb ->> 'documentId' = ${documentId}`)
      trackedEventIds.push(...events.map((event) => event.id))
      const dispatch = events.find(
        (event) => event.eventType === KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT
      )
      if (!dispatch) throw new Error('Knowledge import did not atomically admit processing')
      await deleteWorkspaceFile(ids.workspaceId, source.child.id)
      await deleteFile({ key: source.child.key, context: 'workspace' })
      await deleteFile({ key: archive.key, context: 'execution' })
      await processOutboxEventById(dispatch.id, knowledgeDocumentProcessingOutboxHandlers)
      const [indexed] = await db.select().from(document).where(eq(document.id, documentId))
      expect(indexed.processingStatus, indexed.processingError ?? undefined).toBe('completed')
      const chunks = await listKnowledgeChunks.execute({
        principal: sessionPrincipal(ids),
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
      })
      expect(chunks.chunks.map((chunk) => chunk.content).join('\n')).toContain(REPORT_TEXT)
      const search = await searchKnowledge.execute({
        principal: sessionPrincipal(ids),
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: 'Orion',
          searchMode: 'hybrid',
          topK: 10,
        },
      })
      expect(search.results.map((entry) => entry.documentId)).toContain(documentId)
    }
  )

  it('keeps an explicitly unknown execution source unavailable to model and KB consumers', async () => {
    const ids = await seed()
    const archive = await uploadArchive(ids, { status: 'unknown' })
    const source = await extract(ids, archive)
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, source.identity)).toEqual({
      status: 'unknown',
    })
    expect(
      await importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: ids.workspaceId,
        identity: source.identity,
        registry: new ResolvedSecretTraceRegistry([], {
          userId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
      })
    ).toBe(false)
    await assertBlockedConsumers(ids, source)
  })

  it('retains extracted secret lineage for protected runtime readback without permitting opaque delivery', async () => {
    const ids = await seed()
    const { encrypted } = await encryptSecret(FIXTURE_SECRET)
    const provenance: WorkspaceFileSecretProvenance = {
      status: 'exact',
      entries: [
        {
          name: 'FIXTURE_SECRET',
          encryptedValue: encrypted,
          sourceUserId: ids.aliceId,
          sourceWorkspaceId: ids.workspaceId,
        },
      ],
    }
    const content = `name,description\nOrion,${FIXTURE_SECRET}\n`
    const archive = await uploadArchive(ids, provenance, content)
    const source = await extract(ids, archive)
    expect(source.publicMetadata).not.toContain(FIXTURE_SECRET)
    expect(source.publicMetadata).not.toContain(encrypted)
    expect(source.publicMetadata).not.toContain('encryptedValue')
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, source.identity)).toEqual(
      provenance
    )
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    expect(
      await importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: ids.workspaceId,
        identity: source.identity,
        registry,
      })
    ).toBe(true)
    const storedContent = (
      await downloadFile({ key: source.child.key, context: 'workspace' })
    ).toString()
    expect(storedContent).toBe(content)
    const projected = projectResolvedSecretModelContent(storedContent, registry)
    expect(projected.safe).toBe(true)
    if (!projected.safe) throw new Error('Known extracted lineage withheld runtime readback')
    expect(projected.value).toBe('name,description\nOrion,{{FIXTURE_SECRET}}\n')
    await assertBlockedConsumers(ids, source)
  })

  it('preserves compatibility for execution files created before provenance stamping', async () => {
    const ids = await seed()
    const archive = await uploadArchive(ids)
    const [storedArchive] = await db
      .select({
        secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
        context: workspaceFiles.context,
      })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.key, archive.key))
    expect(storedArchive.secretProvenanceVersion).toBeNull()
    const source = await extract(ids, archive)
    expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, source.identity)).toBe(true)
  })

  it.each([false, true])(
    'refuses tracked unknown execution attachments with historical metadata (archivedOnly=%s)',
    async (archivedOnly) => {
      const ids = await seed()
      const file = await uploadExecutionFile(
        ids,
        Buffer.from(REPORT_CSV),
        'report.csv',
        'text/csv',
        ids.aliceId,
        { status: 'unknown' }
      )
      if (archivedOnly) {
        await db
          .update(workspaceFiles)
          .set({ deletedAt: new Date() })
          .where(eq(workspaceFiles.key, file.key))
      } else {
        await db.insert(workspaceFiles).values({
          id: generateId(),
          key: file.key,
          userId: ids.aliceId,
          workspaceId: ids.workspaceId,
          context: 'execution',
          originalName: 'historical-report.csv',
          contentType: file.type,
          sizeBytes: file.size,
          deletedAt: new Date(),
          contentUpdatedAt: new Date(Date.now() + 60_000),
          secretProvenanceVersion: null,
        })
      }

      expect(
        await filterModelSafeWorkspaceFileAttachments([file], { workspaceId: ids.workspaceId })
      ).toEqual([])
      expect(await isModelSafeWorkspaceFileKey(file.key, { workspaceId: ids.workspaceId })).toBe(
        false
      )
    }
  )

  it.each([
    { status: 'exact', deleted: false },
    { status: 'unknown', deleted: false },
    { status: 'unrecorded', deleted: false },
    { status: 'exact', deleted: true },
    { status: 'unknown', deleted: true },
    { status: 'unrecorded', deleted: true },
  ] as const)(
    'binds $status execution bytes into KB admission despite URL-only classification (deleted=$deleted)',
    async ({ status, deleted }) => {
      const ids = await seed()
      const file = await uploadExecutionFile(
        ids,
        Buffer.from(REPORT_CSV),
        'report.csv',
        'text/csv',
        ids.aliceId,
        status === 'exact' ? { status, entries: [] } : { status }
      )
      if (deleted) {
        await db
          .update(workspaceFiles)
          .set({ deletedAt: new Date() })
          .where(eq(workspaceFiles.key, file.key))
      }
      const admitted = await createSingleDocument(
        {
          filename: file.name,
          fileUrl: `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`,
          fileSize: file.size,
          mimeType: file.type,
        },
        ids.knowledgeBaseId,
        generateId(),
        ids.aliceId,
        undefined,
        {
          filename: { status: 'exact', entries: [] },
          content: { status: 'exact', entries: [] },
          tags: [],
        }
      )
      const [stored] = await db
        .select({
          version: document.secretProvenanceVersion,
          status: documentSecretProvenance.status,
        })
        .from(document)
        .leftJoin(documentSecretProvenance, eq(documentSecretProvenance.documentId, document.id))
        .where(eq(document.id, admitted.id))
      expect(stored).toEqual({ version: 1, status: status === 'unrecorded' ? 'exact' : status })
      const registry = loadKnowledgeDocumentSecretRegistry(admitted.id, {
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
      })
      if (status !== 'unknown') {
        await expect(registry).resolves.toMatchObject({
          tracked: true,
          provenance: { status: 'exact', entries: [] },
        })
      } else {
        await expect(registry).rejects.toThrow(
          'Knowledge document secret provenance is unavailable'
        )
      }
    }
  )

  it('refuses another execution before extracting any workspace files', async () => {
    const ids = await seed()
    const archive = await uploadArchive(ids, { status: 'exact', entries: [] })
    const response = await decompress(ids, archive, generateId())
    expect(response.status).toBe(404)
    const files = await db
      .select({ context: workspaceFiles.context })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.workspaceId, ids.workspaceId))
    expect(files).toEqual([{ context: 'execution' }])
  })
})
