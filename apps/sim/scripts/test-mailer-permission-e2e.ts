import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import postgres from 'postgres'

const logger = createLogger('MailerPermissionE2E')
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}
const base = new URL(required('MAILER_PERMISSION_BASE_URL'))
const database = new URL(required('MAILER_PERMISSION_DATABASE_URL'))
const internalSecret = required('MAILER_PERMISSION_INTERNAL_SECRET')
const reportPath = required('MAILER_PERMISSION_REPORT_PATH')
for (const url of [base, database])
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Loopback services only')
assert(database.pathname.includes('test'), 'Disposable test database required')
assert.equal(base.protocol, 'http:')
const sql = postgres(database.toString(), { max: 2 })
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const http: { tool: string; status: number; success: boolean }[] = []
const userId = generateId()
const workspaceId = generateId()
const externalChat = generateId()
const memberChat = generateId()
const externalStream = generateId()
const memberStream = generateId()
const taskId = generateId()
const admissionId = generateId()
const restriction = {
  version: 1,
  kind: 'external_mailer',
  admissionId,
  inboxTaskId: taskId,
  workspaceId,
}
const admission = {
  version: 1,
  admissionId,
  inboxTaskId: taskId,
  workspaceId,
  executionUserId: userId,
  memberUserId: null,
}

async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
  }
}
async function invoke(
  tool: string,
  params: Record<string, unknown>,
  member = false,
  overrides: Record<string, unknown> = {}
) {
  const response = await fetch(new URL('/api/copilot/tools/execute', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': internalSecret },
    body: JSON.stringify({
      toolCallId: generateId(),
      toolName: tool,
      params,
      userId,
      workspaceId,
      chatId: member ? memberChat : externalChat,
      messageId: member ? memberStream : externalStream,
      requestMode: 'agent',
      userPermission: 'admin',
      ...overrides,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const value: unknown = await response.json()
  assert(isRecordLike(value), 'Expected JSON object')
  http.push({ tool, status: response.status, success: value.success === true })
  return { response, value }
}
async function cli(argv: string[], member = false, target = false) {
  return invoke(
    'sim_cli',
    { request: { invocation: { kind: 'cli', argv }, ...(target ? { workspaceId } : {}) } },
    member
  )
}
async function environment() {
  return await sql`SELECT variables FROM workspace_environment WHERE workspace_id = ${workspaceId}`
}
try {
  await sql`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES (${userId},'Mailer test',${`${userId}@example.invalid`},true,now(),now())`
  await sql`INSERT INTO user_stats (id,user_id) VALUES (${generateId()},${userId})`
  await sql`INSERT INTO workspace (id,name,owner_id,billed_account_user_id) VALUES (${workspaceId},'Mailer security test',${userId},${userId})`
  await sql`INSERT INTO permissions (id,user_id,entity_type,entity_id,permission_type) VALUES (${generateId()},${userId},'workspace',${workspaceId},'admin')`
  for (const chatId of [externalChat, memberChat])
    await sql`INSERT INTO copilot_chats (id,user_id,workspace_id,type) VALUES (${chatId},${userId},${workspaceId},'mothership')`
  await sql`INSERT INTO mothership_inbox_task (id,workspace_id,from_email,subject,status,chat_id,execution_admission) VALUES (${taskId},${workspaceId},'outside@example.invalid','test','processing',${externalChat},${sql.json(admission)})`
  for (const [chatId, streamId, policy] of [
    [externalChat, externalStream, restriction],
    [memberChat, memberStream, null],
  ] as const) {
    await sql`INSERT INTO copilot_runs (id,execution_id,chat_id,user_id,workspace_id,stream_id,request_context) VALUES (${generateId()},${generateId()},${chatId},${userId},${workspaceId},${streamId},${sql.json({ source: 'headless_lifecycle', admissionVersion: 1, executionRestriction: policy })})`
  }
  await check('ordinary owner can set a workspace secret through embedded CLI', async () => {
    const { value } = await cli(
      ['secrets', 'set', 'MAILER_TEST', '--scope', 'workspace', '--value', 'synthetic-canary'],
      true
    )
    assert.equal(value.success, true, JSON.stringify(value))
    assert.equal((await environment()).length, 1)
  })
  const before = await environment()
  for (const targeted of [false, true])
    await check(
      `external CLI cannot mutate a read-role secret (explicit target=${targeted})`,
      async () => {
        const { value } = await cli(
          [
            'secrets',
            'set',
            'MAILER_TEST',
            '--scope',
            'workspace',
            '--value',
            'unauthorized-change',
          ],
          false,
          targeted
        )
        assert.equal(value.success, false)
        assert.match(JSON.stringify(value), /external Mailer/)
        assert.deepEqual(await environment(), before)
      }
    )
  await check('external CLI cannot read raw secrets', async () => {
    const { value } = await cli(['secrets', 'list', '--values'])
    assert.equal(value.success, false)
    assert(!JSON.stringify(value).includes('synthetic-canary'))
  })
  await check('external CLI retains stored table list access', async () => {
    const { value } = await cli(['tables', 'list'])
    assert.equal(value.success, true, JSON.stringify(value))
  })
  await check(
    'external CLI retains stored knowledge document metadata with native projection',
    async () => {
      const knowledgeBaseId = generateId()
      const documentId = generateId()
      await sql`INSERT INTO knowledge_base (id,user_id,workspace_id,name) VALUES (${knowledgeBaseId},${userId},${workspaceId},'Mailer stored knowledge')`
      await sql`INSERT INTO document (id,knowledge_base_id,filename,file_url,file_size,mime_type,processing_status) VALUES (${documentId},${knowledgeBaseId},'stored-knowledge-canary.txt','data:text/plain,stored',6,'text/plain','completed')`
      const { value } = await invoke('sim_cli', {
        request: {
          invocation: {
            kind: 'cli',
            argv: ['knowledge', 'documents', 'get', knowledgeBaseId, documentId],
          },
          curate: 'knowledge-documents',
        },
      })
      assert.equal(value.success, true, JSON.stringify(value))
      assert(JSON.stringify(value).includes('stored-knowledge-canary.txt'))
      assert(JSON.stringify(value).includes(`knowledge/${knowledgeBaseId}/${documentId}`))
    }
  )
  await check('external CLI refuses block curation on an otherwise allowed read', async () => {
    const { value } = await invoke('sim_cli', {
      request: { invocation: { kind: 'cli', argv: ['tables', 'list'] }, curate: 'block' },
    })
    assert.equal(value.success, false)
    assert.match(JSON.stringify(value), /external Mailer/i)
  })
  await check('ordinary owner creates a file that external Mailer can read', async () => {
    const created = await cli(
      ['files', 'create', '--name', 'mailer-readable.txt', '--content', 'stored-workspace-canary'],
      true
    )
    assert.equal(created.value.success, true, JSON.stringify(created.value))
    const [file] =
      await sql`SELECT id FROM workspace_files WHERE workspace_id = ${workspaceId} AND original_name = 'mailer-readable.txt'`
    assert(file, 'Created file must be persisted')
    const read = await cli(['files', 'get', file.id])
    assert.equal(read.value.success, true, JSON.stringify(read.value))
    assert(JSON.stringify(read.value).includes('stored-workspace-canary'))
    const augmented = await invoke('sim_cli', {
      request: {
        invocation: { kind: 'augmentation', name: 'files read', positionals: [file.id], flags: {} },
      },
    })
    assert.equal(augmented.value.success, true, JSON.stringify(augmented.value))
    assert(JSON.stringify(augmented.value).includes('stored-workspace-canary'))
  })
  await check('stored file metadata retains known-secret redaction', async () => {
    const created = await cli(
      ['files', 'create', '--name', 'synthetic-canary.txt', '--content', 'ordinary content'],
      true
    )
    assert.equal(created.value.success, true, JSON.stringify(created.value))
    const listed = await cli(['files', 'list'])
    assert.equal(listed.value.success, true, JSON.stringify(listed.value))
    assert(!JSON.stringify(listed.value).includes('synthetic-canary'), JSON.stringify(listed.value))
  })
  await check('external file view retains stored image access', async () => {
    const created = await cli(
      [
        'files',
        'create',
        '--name',
        'mailer-image.svg',
        '--content',
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>',
      ],
      true
    )
    assert.equal(created.value.success, true, JSON.stringify(created.value))
    const [file] =
      await sql`SELECT id FROM workspace_files WHERE workspace_id=${workspaceId} AND original_name='mailer-image.svg'`
    assert(file)
    const { value } = await invoke('sim_cli', {
      request: {
        invocation: { kind: 'augmentation', name: 'files view', positionals: [file.id], flags: {} },
      },
    })
    assert.equal(value.success, true, JSON.stringify(value))
    assert(isRecordLike(value.output))
    const observations = value.output.observations
    assert(Array.isArray(observations) && observations.length === 1)
    assert.match(observations[0].mediaType, /^image\/(png|jpeg|webp|gif)$/)
    assert(Buffer.from(observations[0].data, 'base64').length > 0)
  })
  await check('file augmentation cannot read private chat uploads by id or path', async () => {
    const created = await cli(
      ['files', 'create', '--name', 'private-upload.txt', '--content', 'private-upload-canary'],
      true
    )
    assert.equal(created.value.success, true, JSON.stringify(created.value))
    const [upload] =
      await sql`UPDATE workspace_files SET context='mothership',chat_id=${externalChat},display_name='private-upload.txt'
      WHERE workspace_id=${workspaceId} AND original_name='private-upload.txt' RETURNING id`
    assert(upload)
    const direct = await cli(['files', 'get', upload.id])
    assert.equal(direct.value.success, false, JSON.stringify(direct.value))
    assert.match(JSON.stringify(direct.value), /File not found/)
    for (const name of ['files read', 'files view']) {
      for (const reference of [upload.id, 'uploads/private-upload.txt']) {
        const { value } = await invoke('sim_cli', {
          request: {
            invocation: { kind: 'augmentation', name, positionals: [reference], flags: {} },
          },
        })
        assert.equal(value.success, false, JSON.stringify(value))
        assert.match(JSON.stringify(value), /File not found/)
        assert(!JSON.stringify(value).includes('private-upload-canary'))
      }
    }
  })
  await check('file augmentation cannot read private sandbox files', async () => {
    const { value } = await invoke('sim_cli', {
      request: {
        invocation: {
          kind: 'augmentation',
          name: 'files read',
          positionals: ['/tmp/private.txt'],
          flags: {},
        },
      },
    })
    assert.equal(value.success, false)
    assert.match(JSON.stringify(value), /Operation unavailable to external Mailer senders/)
  })
  await check('external CLI retains stored file list access', async () => {
    const { value } = await cli(['files', 'list'])
    assert.equal(value.success, true, JSON.stringify(value))
  })
  for (const tool of ['run_code', 'run_workflow', 'gmail_send_email', 'http_request'])
    await check(`external ${tool} denied before dispatch`, async () => {
      const { value } = await invoke(tool, {})
      assert.equal(value.success, false)
      assert.match(JSON.stringify(value), /external Mailer|External Mailer/)
    })
  await check('missing stream binding fails closed', async () => {
    const { response } = await invoke('sim_cli', {}, false, { messageId: undefined })
    assert.equal(response.status, 403)
  })
  await check('forged chat binding fails closed', async () => {
    const { response } = await invoke('sim_cli', {}, false, { chatId: memberChat })
    assert.equal(response.status, 403)
  })
  await check('unknown restriction version fails closed', async () => {
    await sql`UPDATE copilot_runs SET request_context = ${sql.json({ executionRestriction: { ...restriction, version: 99 } })} WHERE stream_id = ${externalStream}`
    const { response } = await invoke('sim_cli', {})
    assert.equal(response.status, 403)
    await sql`UPDATE copilot_runs SET request_context = ${sql.json({ executionRestriction: restriction })} WHERE stream_id = ${externalStream}`
  })
  await check('terminal run replay fails closed', async () => {
    await sql`UPDATE copilot_runs SET status = 'complete' WHERE stream_id = ${externalStream}`
    const { response } = await invoke('sim_cli', {})
    assert.equal(response.status, 403)
  })
} finally {
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        checks,
        http,
        fixture: { workspaceId, externalChat, externalStream },
        passed: checks.filter((check) => check.status === 'passed').length,
        failed: checks.filter((check) => check.status === 'failed').length,
      },
      null,
      2
    )
  )
  await sql.end()
}
const failed = checks.filter((check) => check.status === 'failed')
logger.info('Mailer permission report', {
  reportPath,
  passed: checks.length - failed.length,
  failed: failed.length,
})
if (failed.length) process.exitCode = 1
