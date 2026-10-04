import assert from 'node:assert/strict'
import { mkdir, readFile, truncate, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import Redis from 'ioredis'
import postgres from 'postgres'
import sharp from 'sharp'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getStorageProvider } from '@/lib/uploads/config'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { storeCompiledDoc } from '@/lib/uploads/documents/compiled-store'

/** Real public wire/cookie proof; SQL and Redis only seed disposable sharing and OTP fixtures. */
const base = new URL(required(process.env.PROJECT_FILE_PUBLIC_BASE_URL))
const databaseUrl = new URL(required(process.env.DATABASE_URL))
const redisUrl = new URL(required(process.env.REDIS_URL))
for (const url of [base, databaseUrl, redisUrl])
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local runtime required')
assert.match(databaseUrl.pathname, /test/i, 'Disposable database required')
assert.equal(base.protocol, 'http:')
const reportPath = required(process.env.PROJECT_FILE_PUBLIC_REPORT_PATH)
const fixtureDir = required(process.env.PROJECT_FILE_PUBLIC_FIXTURE_DIR)
const keepFixtures = process.env.PROJECT_FILE_PUBLIC_KEEP_FIXTURES === '1'
const sql = postgres(databaseUrl.toString(), { max: 2 })
const redis = new Redis(redisUrl.toString(), { maxRetriesPerRequest: 1 })
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []
const files: { owner: 'workspace' | 'project'; ownerId: string; id: string }[] = []
const shares: { id: string; token: string; fileId: string; owner: 'workspace' | 'project' }[] = []
const otpKeys: string[] = []
const proofIp = '203.0.113.241'
function required(value: unknown): string {
  assert.ok(typeof value === 'string' && value, 'Required environment or fixture field missing')
  return value
}
async function fixture(name: string) {
  return toRecord(JSON.parse(await readFile(join(fixtureDir, name), 'utf8')))
}
const account = await fixture('owner-account.json')
const sessionCookie = toArray(account.cookies)
  .map((value) => required(value).split(';')[0])
  .join('; ')
const projectId = required(toRecord((await fixture('http-project-fixture.json')).project).id)
const workspaceId = required(process.env.PROJECT_FILE_PUBLIC_WORKSPACE_ID)
const [actor] = await sql<{ email: string }[]>`
  SELECT u.email FROM project p JOIN "user" u ON u.id = p.owner_id WHERE p.id = ${projectId}
`
assert.ok(actor, 'Project owner fixture missing')
const allowedEmail = actor.email
const password = 'Local-public-file-proof-password'
const encryptedPassword = (await encryptSecret(password)).encrypted
const image = await sharp({
  create: { width: 96, height: 96, channels: 4, background: '#1976d2' },
})
  .png()
  .toBuffer()

async function request(
  path: string,
  options: { method?: string; body?: Record<string, unknown>; cookie?: string } = {}
) {
  const headers = new Headers({
    Origin: base.origin,
    'Content-Type': 'application/json',
    'X-Forwarded-For': proofIp,
  })
  if (options.cookie) headers.set('Cookie', options.cookie)
  // boundary-raw-fetch: this proof exercises actual public binary, RSC, and credential HTTP surfaces.
  const response = await fetch(new URL(path, base), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(90_000),
    redirect: 'manual',
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, buffer, text: buffer.toString() }
}
function json(response: Awaited<ReturnType<typeof request>>, status = 200) {
  assert.equal(response.status, status)
  return toRecord(JSON.parse(response.text))
}
function assertBinaryError(response: Awaited<ReturnType<typeof request>>, status: 404 | 413) {
  const body = json(response, status)
  assert.deepEqual(Object.keys(body).sort(), ['error', 'message'])
  assert.equal(body.error, status === 404 ? 'FileNotFoundError' : 'PayloadSizeLimitError')
  if (status === 404) assert.equal(body.message, 'Not found')
  else assert.ok(typeof body.message === 'string' && body.message.includes('104857600'))
}
async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, passed: true, durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      passed: false,
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
}
async function withEmptyRateBucket(key: string, run: () => Promise<void>) {
  const redisKey = `ratelimit:tb:${key}`
  const original = await redis.hgetall(redisKey)
  const ttl = await redis.pttl(redisKey)
  await redis.hset(redisKey, { tokens: '0', lastRefillAt: String(Date.now()) })
  await redis.expire(redisKey, 120)
  try {
    await run()
  } finally {
    await redis.del(redisKey)
    if (Object.keys(original).length) {
      await redis.hset(redisKey, original)
      if (ttl > 0) await redis.pexpire(redisKey, ttl)
    }
  }
}
async function expectRateLimit(path: string, options?: Parameters<typeof request>[1]) {
  const response = await request(path, options)
  assert.equal(response.status, 429)
  assert.ok(Number(response.headers.get('retry-after')) > 0, 'Retry-After missing')
}
async function withSparseFile(fileId: string, bytes: number, run: () => Promise<void>) {
  assert.equal(getStorageProvider(), 'Local', 'Sparse boundary proof requires local storage')
  const [row] = await sql<{ key: string }[]>`SELECT key FROM workspace_files WHERE id=${fileId}`
  assert.ok(row && files.some((file) => file.id === fileId), 'Only this run fixture may be resized')
  const path = resolve(UPLOAD_DIR_SERVER, row.key)
  assert.ok(path.startsWith(`${resolve(UPLOAD_DIR_SERVER)}${sep}`))
  const original = await readFile(path)
  try {
    await truncate(path, bytes)
    await run()
  } finally {
    await writeFile(path, original)
  }
}
async function createFile(
  owner: 'workspace' | 'project',
  name: string,
  content: string,
  type: string,
  encoding = 'utf-8'
) {
  const ownerId = owner === 'project' ? projectId : workspaceId
  const file = toRecord(
    json(
      await request(`/api/${owner === 'project' ? 'projects' : 'workspaces'}/${ownerId}/files`, {
        method: 'POST',
        cookie: sessionCookie,
        body: { name, content, contentType: type, encoding },
      }),
      201
    ).file
  )
  files.push({ owner, ownerId, id: required(file.id) })
  return file
}
async function shareFile(owner: 'workspace' | 'project', fileId: string) {
  const id = generateId()
  const token = generateShortId()
  await sql`INSERT INTO public_share (id, resource_type, resource_id, entity_type, entity_id, workspace_id, created_by, token)
    SELECT ${id}, 'file', f.id, f.entity_type, f.entity_id, f.workspace_id, f.user_id, ${token}
    FROM workspace_files f WHERE f.id = ${fileId}`
  const share = { id, token, fileId, owner }
  shares.push(share)
  return share
}
function cookieFrom(response: Awaited<ReturnType<typeof request>>, shareId: string) {
  const value = response.headers.get('set-cookie') ?? ''
  assert.ok(value.startsWith(`file_auth_${shareId}=`), 'Expected resource-bound auth cookie')
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=86400'])
    assert.ok(
      value.toLowerCase().includes(attribute.toLowerCase()),
      `Missing ${attribute} cookie attribute`
    )
  return value.split(';')[0]
}
try {
  const browserFixtures = []
  for (const owner of ['workspace', 'project'] as const) {
    const suffix = generateShortId(8)
    const photo = await createFile(
      owner,
      `public-photo-${suffix}.png`,
      image.toString('base64'),
      'image/png',
      'base64'
    )
    const reference =
      owner === 'project'
        ? `sim:file/${required(photo.id)}?project=${projectId}`
        : `/api/files/view/${required(photo.id)}`
    const privateReference =
      owner === 'project'
        ? `/api/projects/${projectId}/files/${required(photo.id)}/content`
        : `/api/files/view/${required(photo.id)}`
    const source = `# Public owner proof\n\n![Canonical image](${reference})\n\n![Private URL image](${privateReference})\n`
    const doc = await createFile(owner, `public-document-${suffix}.md`, source, 'text/markdown')
    const share = await shareFile(owner, required(doc.id))
    browserFixtures.push({
      owner,
      fileId: doc.id,
      imageId: photo.id,
      token: share.token,
      source,
      privateUrl: `/workspace/${workspaceId}/files/${required(doc.id)}${owner === 'project' ? `?owner=project&projectId=${projectId}` : ''}`,
      publicUrl: `/f/${share.token}`,
    })
    const path = `/api/files/public/${share.token}`
    await check(`${owner}: public metadata and source preserve safe wire and headers`, async () => {
      const metadata = json(await request(path))
      assert.equal(metadata.name, doc.name)
      assert.deepEqual(Object.keys(metadata).sort(), [
        'name',
        'ownerName',
        'size',
        'token',
        'type',
        'workspaceName',
      ])
      assert.ok(
        typeof metadata.workspaceName === 'string' && metadata.workspaceName,
        'Canonical owner display name missing'
      )
      const bytes = await request(`${path}/content`)
      assert.equal(bytes.status, 200)
      assert.equal(bytes.text, source)
      assert.equal(bytes.headers.get('cache-control'), 'private, no-cache, must-revalidate')
      assert.equal(bytes.headers.get('x-content-type-options'), 'nosniff')
      assert.match(bytes.headers.get('content-disposition') ?? '', /filename=/)
    })
    await check(`${owner}: inline image requires the current document grant`, async () => {
      const bytes = await request(`${path}/inline?fileId=${required(photo.id)}`)
      assert.equal(bytes.status, 200)
      assert.ok(bytes.buffer.equals(image), 'Inline bytes differ from fixture')
      assert.equal(bytes.headers.get('content-type'), 'image/png')
      assertBinaryError(await request(`${path}/inline?fileId=unreferenced`), 404)
      assert.equal(
        (await request(`${path}/inline?fileId=${required(photo.id)}&key=other`)).status,
        400
      )
    })
    await check(
      `${owner}: source and inline scan enforce independent real byte ceilings`,
      async () => {
        await withSparseFile(required(doc.id), 100 * 1024 * 1024 + 1, async () => {
          assertBinaryError(await request(`${path}/content`), 413)
          assertBinaryError(await request(`${path}/inline?fileId=${required(photo.id)}`), 404)
        })
        await withSparseFile(required(photo.id), 100 * 1024 * 1024 + 1, async () => {
          assertBinaryError(await request(`${path}/inline?fileId=${required(photo.id)}`), 413)
        })
      }
    )
    await check(
      `${owner}: a small generated source cannot bypass the compiled output ceiling`,
      async () => {
        assert.equal(getStorageProvider(), 'Local', 'Artifact fixture requires local storage')
        const source = `// Public output ceiling fixture ${suffix}`
        const generated = await createFile(
          owner,
          `public-output-${suffix}.pptx`,
          source,
          'text/x-pptxgenjs'
        )
        const artifactShare = await shareFile(owner, required(generated.id))
        const contentPath = `/api/files/public/${artifactShare.token}/content`
        const unavailable = await request(contentPath)
        assert.equal(
          json(unavailable, 409).error,
          'This document is still being prepared. Please try again shortly.'
        )
        let key: string | undefined
        await storeCompiledDoc(
          { entityType: owner, entityId: owner === 'workspace' ? workspaceId : projectId },
          source,
          'pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          Buffer.from('PK\u0003\u0004output-fixture'),
          undefined,
          (writtenKey) => {
            key = writtenKey
          }
        )
        const path = resolve(UPLOAD_DIR_SERVER, required(key))
        assert.ok(path.startsWith(`${resolve(UPLOAD_DIR_SERVER)}${sep}`))
        try {
          await truncate(path, 100 * 1024 * 1024 + 1)
          assertBinaryError(await request(contentPath), 413)
        } finally {
          await unlink(path)
        }
      }
    )
    await check(`${owner}: public read budgets precede target lookup`, async () => {
      const unknown = `/api/files/public/${generateShortId()}`
      for (const [scope, target] of [
        ['metadata', unknown],
        ['content', `${unknown}/content`],
        ['inline', `${unknown}/inline?fileId=unknown`],
      ])
        await withEmptyRateBucket(`public-file:${scope}:${proofIp}`, () => expectRateLimit(target))
    })
    await check(`${owner}: public mode cannot mint a password cookie`, async () => {
      const response = await request(path, { method: 'POST', body: { password } })
      json(response, 400)
      assert.equal(response.headers.get('set-cookie'), null)
    })
    await sql`UPDATE public_share SET auth_type='password', password=${encryptedPassword} WHERE id=${share.id}`
    await check(
      `${owner}: protected RSC hides filename while password cookie unlocks bytes`,
      async () => {
        const page = await request(`/f/${share.token}`)
        assert.equal(page.status, 200)
        assert.equal(
          page.text.includes(required(doc.name)),
          false,
          'Protected page disclosed filename'
        )
        assert.equal(json(await request(path), 401).error, 'auth_required_password')
        assert.equal(
          json(await request(path, { method: 'POST', body: { password: 'wrong' } }), 401).error,
          'Invalid password'
        )
        for (const rateKey of [
          `file-password:ip:${share.id}:${proofIp}`,
          `file-password:resource:${share.id}`,
        ])
          await withEmptyRateBucket(rateKey, () =>
            expectRateLimit(path, { method: 'POST', body: { password } })
          )
        const accepted = await request(path, { method: 'POST', body: { password } })
        assert.equal(json(accepted).authType, 'password')
        const cookie = cookieFrom(accepted, share.id)
        assert.equal((await request(`${path}/content`, { cookie })).text, source)
        await sql`UPDATE public_share SET password=${(await encryptSecret(`${password}-changed`)).encrypted} WHERE id=${share.id}`
        assert.equal((await request(`${path}/content`, { cookie })).status, 401)
      }
    )
    await sql`UPDATE public_share SET auth_type='email', password=NULL, allowed_emails=${sql.json([allowedEmail])} WHERE id=${share.id}`
    await check(
      `${owner}: email OTP denial, consumption, and cookie policy stay current`,
      async () => {
        const rejectedEmail = 'public-proof-rejected@example.invalid'
        await withEmptyRateBucket(`file-otp:ip:${proofIp}`, () =>
          expectRateLimit(`${path}/otp`, { method: 'POST', body: { email: rejectedEmail } })
        )
        assert.equal(
          json(await request(`${path}/otp`, { method: 'POST', body: { email: rejectedEmail } }))
            .message,
          'Verification code sent'
        )
        assert.equal(
          (
            await request(`${path}/otp`, {
              method: 'PUT',
              body: { email: rejectedEmail, otp: '123456' },
            })
          ).status,
          403
        )
        const key = `otp:file:${allowedEmail}:${share.id}`
        otpKeys.push(key)
        await redis.set(key, '123456:0', 'EX', 900)
        assert.equal(
          (
            await request(`${path}/otp`, {
              method: 'PUT',
              body: { email: allowedEmail, otp: '000000' },
            })
          ).status,
          400
        )
        const accepted = await request(`${path}/otp`, {
          method: 'PUT',
          body: { email: allowedEmail, otp: '123456' },
        })
        assert.equal(json(accepted).authType, 'email')
        const cookie = cookieFrom(accepted, share.id)
        assert.equal(await redis.get(key), null, 'Successful verification did not consume OTP')
        await redis.set(key, '123456:4', 'EX', 900)
        assert.equal(
          (
            await request(`${path}/otp`, {
              method: 'PUT',
              body: { email: allowedEmail, otp: '000000' },
            })
          ).status,
          429
        )
        assert.equal(await redis.get(key), null, 'Attempt exhaustion did not consume OTP')
        assert.equal((await request(path, { cookie })).status, 200)
        await sql`UPDATE public_share SET allowed_emails='[]'::json WHERE id=${share.id}`
        assert.equal((await request(path, { cookie })).status, 401)
      }
    )
    await sql`UPDATE public_share SET auth_type='sso', allowed_emails=${sql.json([allowedEmail])} WHERE id=${share.id}`
    await check(`${owner}: SSO eligibility alone never grants file access`, async () => {
      for (const rateKey of [`file-sso:ip:${proofIp}`, `file-sso:resource:${share.id}`])
        await withEmptyRateBucket(rateKey, () =>
          expectRateLimit(`${path}/sso`, { method: 'POST', body: { email: allowedEmail } })
        )
      assert.equal(
        json(await request(`${path}/sso`, { method: 'POST', body: { email: allowedEmail } }))
          .eligible,
        true
      )
      assert.equal(
        json(
          await request(`${path}/sso`, {
            method: 'POST',
            body: { email: 'rejected@example.invalid' },
          })
        ).eligible,
        false
      )
      assert.equal(json(await request(path), 401).error, 'auth_required_sso')
      assert.equal((await request(path, { cookie: sessionCookie })).status, 200)
    })
    await sql`UPDATE public_share SET auth_type='public', password=NULL, allowed_emails='[]'::json WHERE id=${share.id}`
  }
  await writeFile(
    join(fixtureDir, 'public-browser-fixtures.json'),
    JSON.stringify({ projectId, workspaceId, files: browserFixtures }, null, 2),
    { mode: 0o600 }
  )
} catch (error) {
  checks.push({
    name: 'fixture setup',
    passed: false,
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  if (!keepFixtures) {
    for (const share of shares)
      await sql`UPDATE public_share SET is_active=false WHERE id=${share.id}`
    for (const owner of ['workspace', 'project'] as const) {
      const owned = files.filter((file) => file.owner === owner)
      const first = owned[0]
      if (!first) continue
      await check(`${owner}: fixture cleanup archives only this run's files`, async () => {
        const prefix = `/api/${owner === 'project' ? 'projects' : 'workspaces'}/${first.ownerId}/files`
        json(
          await request(`${prefix}/${owner === 'project' ? 'archive' : 'bulk-archive'}`, {
            method: 'POST',
            cookie: sessionCookie,
            body: { fileIds: owned.map((file) => file.id) },
          })
        )
      })
    }
  }
  for (const key of otpKeys) await redis.del(key)
  await redis.quit()
  await sql.end()
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
}
process.exitCode = checks.some((entry) => !entry.passed) ? 1 : 0
