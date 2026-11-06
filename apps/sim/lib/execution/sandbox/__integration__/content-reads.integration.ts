import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { db } from '@sim/db'
import { auditLog, organization, user, workspace, workspaceFiles } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return storage.root
  },
}))
vi.mock('@/tools', () => toolsMock)

import { observeContentDelivery } from '@/lib/core/application'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery'
import { executeFunctionExecute } from '@/lib/mothership/tools/handlers/function-execute'
import { compileDocForWrite } from '@/lib/mothership/tools/server/files/workspace-file'
import {
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { getBoundWorkspaceFileSecretProvenanceByIdentity } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { compileDoc } from '@/lib/uploads/documents/compile'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const execute = promisify(execFile)
const secret = 'synthetic-broker-value-987654321'

describe('Chat admits the file revision used by a sandbox', () => {
  const ids = createKnowledgeAclFixtureIds()
  const chatId = generateId()
  let fileId: string
  let workbench: string

  beforeAll(async () => {
    storage.root = await mkdtemp(join(tmpdir(), 'sim-broker-content-'))
    workbench = await mkdtemp(join(tmpdir(), 'sim-input-content-'))
    await seedKnowledgeAclFixture(ids)
    const file = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from('public bytes'),
      'source.txt',
      'text/plain',
      { notifyWorkspaceChange: false }
    )
    fileId = file.id
  })
  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(storage.root, { recursive: true, force: true })
    await rm(workbench, { recursive: true, force: true })
  })

  function compile(source: string, registry: ResolvedSecretTraceRegistry) {
    return observeContentDelivery(
      createRegistryContentGate({
        registry,
        workspaceId: ids.workspaceId,
        actorUserId: ids.aliceId,
      }),
      () =>
        compileDoc({
          source,
          fileName: 'fixture.pdf',
          workspaceId: ids.workspaceId,
          filePrincipal: createCopilotChatFilePrincipal({
            userId: ids.aliceId,
            workspaceId: ids.workspaceId,
            chatId,
          }),
        })
    )
  }
  function registry() {
    return new ResolvedSecretTraceRegistry([], {
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
  }

  it('reads variable file references through the real isolated worker and invalidates cached source revisions', async () => {
    const source = `const id = ${JSON.stringify(fileId)}; const data = await getFileBase64(id); pdf.addPage().drawText(data);`
    const first = await compile(source, registry())
    expect(first.buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(first.contributingFiles).toHaveLength(1)
    await updateWorkspaceFileContent(
      ids.workspaceId,
      fileId,
      ids.aliceId,
      Buffer.from('updated public bytes'),
      undefined,
      {
        version: { source: 'api', authorUserId: ids.aliceId },
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'exact', entries: [] } },
      }
    )
    const second = await compile(source, registry())
    expect(second.contributingFiles?.[0].key).not.toBe(first.contributingFiles?.[0].key)
    const revisions = [...(first.contributingFiles ?? []), ...(second.contributingFiles ?? [])]
    for (const identities of [revisions, [...revisions].reverse()]) {
      const bound = await getBoundWorkspaceFileSecretProvenanceByIdentity(
        ids.workspaceId,
        identities
      )
      expect(bound.get(fileId)).toEqual({ status: 'unknown' })
    }
    await updateWorkspaceFileContent(
      ids.workspaceId,
      fileId,
      ids.aliceId,
      Buffer.from('unverified bytes'),
      undefined,
      {
        version: { source: 'api', authorUserId: ids.aliceId },
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'unknown' } },
      }
    )
    await expect(compile(source, registry())).rejects.toThrow(/provenance|read safely/i)
  }, 60_000)

  it('imports evidence before a broker response can appear in a compiler error', async () => {
    await updateWorkspaceFileContent(
      ids.workspaceId,
      fileId,
      ids.aliceId,
      Buffer.from(secret),
      undefined,
      {
        version: { source: 'api', authorUserId: ids.aliceId },
        secretProvenancePolicy: {
          mode: 'replace',
          provenance: {
            status: 'exact',
            entries: [
              {
                name: 'BROKER_TOKEN',
                sourceUserId: ids.aliceId,
                sourceWorkspaceId: ids.workspaceId,
                encryptedValue: (await encryptSecret(secret)).encrypted,
              },
            ],
          },
        },
      }
    )
    const trace = registry()
    let message = ''
    try {
      await compile(
        `const id = ${JSON.stringify(fileId)}; const uri = await getFileBase64(id); throw new Error(Buffer.from(uri.split(',')[1], 'base64').toString());`,
        trace
      )
    } catch (error) {
      if (!(error instanceof Error)) throw error
      message = error.message
    }
    expect(message).toContain(secret)
    const projected = projectResolvedSecretModelContent(message, trace)
    if (!projected.safe) throw new Error('Expected a safely projected compiler error')
    expect(projected.value).not.toContain(secret)
    expect(projected.value).toContain('{{BROKER_TOKEN}}')
  }, 60_000)

  it('admits broker inputs during legacy document-write validation before returning compiler errors', async () => {
    const principal = createCopilotChatFilePrincipal({
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      chatId,
    })
    const validate = (source: string, trace: ResolvedSecretTraceRegistry) =>
      observeContentDelivery(
        createRegistryContentGate({
          registry: trace,
          workspaceId: ids.workspaceId,
          actorUserId: ids.aliceId,
        }),
        () =>
          compileDocForWrite({
            source,
            fileName: 'write-validation.pdf',
            workspaceId: ids.workspaceId,
            principal,
            ownerKey: `user:${ids.aliceId}`,
            fallbackMime: 'application/pdf',
          })
      )

    await updateWorkspaceFileContent(
      ids.workspaceId,
      fileId,
      ids.aliceId,
      Buffer.from('unverified input'),
      undefined,
      {
        version: { source: 'api', authorUserId: ids.aliceId },
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'unknown' } },
      }
    )
    const refused = await validate(
      `const id = ${JSON.stringify(fileId)}; await getFileBase64(id); pdf.addPage();`,
      registry()
    )
    expect.soft(refused).toMatchObject({ ok: false })
    if (!refused.ok) expect(refused.message).toMatch(/provenance|read safely/i)

    await updateWorkspaceFileContent(
      ids.workspaceId,
      fileId,
      ids.aliceId,
      Buffer.from(secret),
      undefined,
      {
        version: { source: 'api', authorUserId: ids.aliceId },
        secretProvenancePolicy: {
          mode: 'replace',
          provenance: {
            status: 'exact',
            entries: [
              {
                name: 'BROKER_TOKEN',
                sourceUserId: ids.aliceId,
                sourceWorkspaceId: ids.workspaceId,
                encryptedValue: (await encryptSecret(secret)).encrypted,
              },
            ],
          },
        },
      }
    )
    const trace = registry()
    const failed = await validate(
      `const id = ${JSON.stringify(fileId)}; const uri = await getFileBase64(id); throw new Error(Buffer.from(uri.split(',')[1], 'base64').toString());`,
      trace
    )
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error('Expected the document source to fail')
    expect(failed.message).toContain(secret)
    const projected = projectResolvedSecretModelContent(failed.message, trace)
    if (!projected.safe) throw new Error('Expected a safely projected compiler error')
    expect(projected.value).not.toContain(secret)
    expect(projected.value).toContain('{{BROKER_TOKEN}}')
  }, 60_000)

  it('keeps successful legacy dynamic-input documents readable after their first compile', async () => {
    const references = Array.from({ length: 501 }, (_, index) => ({
      id: `wf_${generateId()}`,
      key: `workspace/${ids.workspaceId}/cache-reference-${generateId()}.txt`,
      originalName: `reference-${index}.txt`,
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      context: 'workspace',
      contentType: 'text/plain',
      sizeBytes: 6,
    }))
    await db.insert(workspaceFiles).values(references)
    await mkdir(join(storage.root, 'workspace', ids.workspaceId), { recursive: true })
    for (const reference of references) {
      await writeFile(join(storage.root, reference.key), 'public')
    }
    const source = `const ids = ${JSON.stringify(references.map((file) => file.id))}; for (const id of ids) await getFileBase64(id); pdf.addPage().drawText('compiled all references');`
    const first = await compile(source, registry())
    expect(first.buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(first.contributingFiles).toHaveLength(references.length)
    const second = await compile(source, registry())
    expect(second.buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(second.contributingFiles).toHaveLength(references.length)
  }, 120_000)

  it('does not run code with a stale local file after refusing its requested replacement', async () => {
    await updateWorkspaceFileContent(
      ids.workspaceId,
      fileId,
      ids.aliceId,
      Buffer.from('unverified replacement'),
      undefined,
      {
        version: { source: 'api', authorUserId: ids.aliceId },
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'unknown' } },
      }
    )
    await writeFile(join(workbench, 'source.txt'), 'previous mounted version')
    await writeFile(join(workbench, 'result.txt'), 'not executed')
    toolsMockFns.mockExecuteTool.mockImplementation(async (_id, params: { code: string }) => {
      const output = await execute(process.execPath, ['-e', params.code], { cwd: workbench })
      return { success: true, output }
    })
    const context = {
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      chatId,
      toolCallId: generateId(),
      workflowId: '',
      copilotToolExecution: true,
      resolvedSecretTraceRegistry: registry(),
    }
    const code =
      "const fs = require('node:fs'); fs.writeFileSync('result.txt', fs.readFileSync('source.txt'));"
    const result = await executeFunctionExecute(
      {
        code,
        language: 'javascript',
        inputs: { files: [{ path: fileId, sandboxPath: '/tmp/source.txt' }] },
      },
      context
    )
    expect(await readFile(join(workbench, 'result.txt'), 'utf8')).toBe('not executed')
    expect(result).toMatchObject({
      success: false,
      output: { codeExecuted: false, excludedInputs: [{ path: '/tmp/source.txt' }] },
    })
    expect(context.resolvedSecretTraceRegistry.isComplete()).toBe(true)
    const next = await executeFunctionExecute(
      { code: "process.stdout.write('clock usable')", language: 'javascript' },
      context
    )
    expect(next).toMatchObject({ success: true, output: { stdout: 'clock usable' } })
  })
})
