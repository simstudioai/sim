import assert from 'node:assert/strict'
import { join } from 'node:path'
import { sha256Hex } from '@sim/security/hash'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import type { FilesE2EContext } from '@/scripts/files-e2e/types'

/** Exercises anonymous folder capabilities through real routes and Chromium, including revocation. */
export async function runSharingChecks({
  fixture,
  sql,
  page,
  baseUrl,
  reportDirectory,
  check,
  json,
}: FilesE2EContext) {
  const filesPath = `/api/workspaces/${fixture.workspaceId}/files`
  const createFolder = async (name: string, parentId: string | null = null) => {
    const result = await json(`${filesPath}/folders`, { method: 'POST', body: { name, parentId } })
    assert(isRecordLike(result.folder) && typeof result.folder.id === 'string')
    return result.folder.id
  }
  const createFile = async (
    name: string,
    folderId: string,
    content: string,
    contentType = 'text/plain',
    encoding = 'utf-8'
  ) => {
    const result = await json(filesPath, {
      method: 'POST',
      body: { name, folderId, content, contentType, encoding },
      expected: 201,
    })
    assert(isRecordLike(result.file) && typeof result.file.id === 'string')
    return result.file.id
  }
  const rootId = await createFolder('Sharing fixture')
  const childId = await createFolder('Nested shared', rootId)
  const privateId = await createFolder('Private sibling')
  const firstContent = 'FOLDER_FIRST_PREVIEW=one\n'
  const secondContent = 'FOLDER_SECOND_PREVIEW=two\n'
  const firstId = await createFile('env.template', childId, firstContent)
  const secondId = await createFile('env.example', childId, secondContent)
  const privateFileId = await createFile('private.txt', privateId, 'PRIVATE_NOT_SHARED\n')
  const rasterId = await createFile(
    'pixel.png',
    privateId,
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lGkAAAAASUVORK5CYII=',
    'image/png',
    'base64'
  )
  const unreferencedId = await createFile(
    'private-pixel.png',
    privateId,
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lGkAAAAASUVORK5CYII=',
    'image/png',
    'base64'
  )
  const forgedId = await createFile(
    'forged.png',
    privateId,
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    'image/png'
  )
  const docId = await createFile(
    'images.md',
    childId,
    `![Referenced pixel](/api/files/view/${rasterId})\n![Forged image](/api/files/view/${forgedId})`,
    'text/markdown'
  )
  const sharePath = `${filesPath}/folders/${rootId}/share`
  const readerId = generateId()
  const readerSessionToken = generateShortId()
  const workspaceKeyId = generateId()
  const workspaceKey = `sk-sim-folder-sharing-fixture-${generateId()}`
  const personalKeyId = generateId()
  const personalKey = `sk-sim-folder-policy-fixture-${generateId()}`
  const foreignWorkspaceId = generateId()
  const foreignFolderId = generateId()
  const foreignShareId = generateId()
  const foreignShareToken = generateShortId()
  const authSecret = process.env.FILES_E2E_AUTH_SECRET
  assert(authSecret && authSecret.length >= 32, 'A local FILES_E2E_AUTH_SECRET is required')
  const readerCookie = encodeURIComponent(
    `${readerSessionToken}.${await makeSignature(readerSessionToken, authSecret)}`
  )
  const readerHeaders = {
    Cookie: `better-auth.session_token=${readerCookie}`,
    Origin: baseUrl.origin,
  }

  const browser = page.context().browser()
  assert(browser)
  const anonymous = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  await anonymous.tracing.start({ screenshots: true, snapshots: true, sources: false })
  const publicGet = (path: string) =>
    anonymous.request.get(new URL(path, baseUrl).href, { timeout: 180_000 })
  const visitor = await anonymous.newPage()
  visitor.setDefaultTimeout(60_000)
  visitor.setDefaultNavigationTimeout(180_000)
  const browserErrors: string[] = []
  visitor.on('pageerror', (error) => browserErrors.push(error.message))
  let token = ''
  let shareId = ''
  const publicPath = () => `/api/files/public/${token}`
  const folderPath = () => `${publicPath()}/folder`
  const contentPath = (fileId: string) => `${publicPath()}/content?fileId=${fileId}`
  const anonymousJson = (path: string, expected = 200) =>
    json(path, { authenticated: false, expected })
  const updateShare = (body: Record<string, unknown>) => json(sharePath, { method: 'PUT', body })

  try {
    await sql.begin(async (tx) => {
      const readerEmail = `files-reader-${readerId}@files-e2e.test`
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${readerId}, 'Files E2E Reader', ${readerEmail}, ${readerEmail}, true, now(), now())`
      await tx`insert into member (id, user_id, organization_id, role)
        values (${generateId()}, ${readerId}, ${fixture.orgId}, 'member')`
      await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
        values (${generateId()}, ${readerId}, 'workspace', ${fixture.workspaceId}, 'read')`
      await tx`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
        values (${generateId()}, ${readerSessionToken}, ${readerId}, ${fixture.orgId}, now() + interval '1 hour', now(), now())`
      await tx`insert into api_key (id, user_id, workspace_id, name, key, key_hash, type)
        values
          (${workspaceKeyId}, ${fixture.ownerId}, ${fixture.workspaceId}, 'Files folder sharing fixture', ${workspaceKey}, ${sha256Hex(workspaceKey)}, 'workspace'),
          (${personalKeyId}, ${fixture.ownerId}, null, 'Files folder policy fixture', ${personalKey}, ${sha256Hex(personalKey)}, 'personal')`
      await tx`insert into workspace (id, name, owner_id, billed_account_user_id)
        values (${foreignWorkspaceId}, 'Foreign sharing fixture', ${readerId}, ${readerId})`
      await tx`insert into folder (id, workspace_id, user_id, resource_type, name)
        values (${foreignFolderId}, ${foreignWorkspaceId}, ${readerId}, 'file', 'Foreign folder')`
      await tx`insert into public_share (id, resource_type, resource_id, workspace_id, created_by, token)
        values (${foreignShareId}, 'folder', ${foreignFolderId}, ${foreignWorkspaceId}, ${readerId}, ${foreignShareToken})`
    })

    await check('folder sharing requires workspace access and a live folder', async () => {
      await json(sharePath, { authenticated: false, expected: 401 })
      await json(sharePath, {
        method: 'PUT',
        authenticated: false,
        body: { isActive: true },
        expected: 401,
      })
      await json(`${filesPath}/folders/${generateId()}/share`, {
        method: 'PUT',
        body: { isActive: true },
        expected: 404,
      })
    })

    await check(
      'read-only members can inspect folder sharing but cannot create or revoke it',
      async () => {
        const before = await json(sharePath, { authenticated: false, headers: readerHeaders })
        assert.equal(before.share, null, 'Reader fixture must have working workspace access')
        for (const isActive of [true, false]) {
          await json(sharePath, {
            method: 'PUT',
            authenticated: false,
            headers: readerHeaders,
            body: { isActive },
            expected: 403,
          })
        }
        assert.equal((await json(sharePath)).share, null, 'Denied writes persisted a share')
      }
    )

    await check('valid workspace API keys cannot publish folder sharing', async () => {
      const headers = { 'x-api-key': workspaceKey }
      await json(`/api/v2/files?workspaceId=${fixture.workspaceId}&limit=1`, {
        authenticated: false,
        headers,
      })
      await json(sharePath, {
        method: 'PUT',
        authenticated: false,
        headers,
        body: { isActive: true },
        expected: 401,
      })
      const denied = await json('/api/v2/tools/file_manage_folder_sharing/execute', {
        method: 'POST',
        authenticated: false,
        headers,
        body: {
          workspaceId: fixture.workspaceId,
          input: { path: '/Sharing%20fixture', isActive: true },
        },
        expected: 403,
      })
      assert(isRecordLike(denied.error))
      assert(isRecordLike(denied.error.details))
      assert.equal(denied.error.details.code, 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED')
      assert.equal((await json(sharePath)).share, null, 'Denied workspace key persisted a share')
    })

    await check(
      'asserting another workspace folder never exposes or mutates its existing share',
      async () => {
        const asserted = `${filesPath}/folders/${foreignFolderId}/share`
        await json(asserted, { expected: 404 })
        await json(asserted, { method: 'PUT', body: { isActive: false }, expected: 404 })
        const [stored] =
          await sql`select token, is_active from public_share where id = ${foreignShareId}`
        assert.equal(stored.token, foreignShareToken)
        assert.equal(stored.is_active, true)
      }
    )

    await check('folder Share modal creates a usable public capability', async () => {
      await page.goto(
        new URL(`/workspace/${fixture.workspaceId}/files?folderId=${rootId}`, baseUrl).href,
        { waitUntil: 'domcontentloaded' }
      )
      await page
        .getByRole('combobox', { name: 'Navigate within Sharing fixture', exact: true })
        .click()
      await page.getByRole('option', { name: 'Share folder', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Share', exact: true }).click()
      await dialog.getByRole('button', { name: 'Unshare', exact: true }).waitFor()
      const result = await json(sharePath)
      assert(isRecordLike(result.share))
      assert.equal(result.share.resourceType, 'folder')
      assert.equal(typeof result.share.token, 'string')
      assert.equal(typeof result.share.id, 'string')
      token = result.share.token as string
      shareId = result.share.id as string
      await page.keyboard.press('Escape')
    })

    await check(
      'folder sharing tools reject oversized email restrictions without mutating policy',
      async () => {
        const headers = { 'x-api-key': personalKey }
        await json(`/api/v2/files?workspaceId=${fixture.workspaceId}&limit=1`, {
          authenticated: false,
          headers,
        })
        const before = await sql`select * from public_share where id = ${shareId}`
        const result = await json('/api/v2/tools/file_manage_folder_sharing/execute', {
          method: 'POST',
          authenticated: false,
          headers,
          body: {
            workspaceId: fixture.workspaceId,
            input: {
              path: '/Sharing%20fixture',
              isActive: true,
              authType: 'email',
              allowedEmails: [`${'a'.repeat(308)}@fixture.test`],
            },
          },
        })
        assert(isRecordLike(result.data))
        assert.equal(result.data.status, 'failed')
        assert(isRecordLike(result.data.output))
        assert.equal(result.data.output.status, 400)
        const after = await sql`select * from public_share where id = ${shareId}`
        assert.deepEqual(after, before, 'Rejected input changed the stored sharing policy')
      }
    )

    await check(
      'anonymous folder reads are bounded, private, and contained to the live subtree',
      async () => {
        const root = await anonymousJson(folderPath())
        assert(Array.isArray(root.entries))
        assert.deepEqual(
          root.entries.map((entry) => {
            assert(isRecordLike(entry))
            return entry.id
          }),
          [childId]
        )
        const nested = await anonymousJson(`${folderPath()}?folderId=${childId}`)
        assert(Array.isArray(nested.breadcrumbs))
        assert.deepEqual(
          nested.breadcrumbs.map((entry) => {
            assert(isRecordLike(entry))
            return entry.id
          }),
          [rootId, childId]
        )
        await anonymousJson(`${folderPath()}?folderId=${privateId}`, 404)
        await anonymousJson(`${folderPath()}?folderId=${foreignFolderId}`, 404)
        await anonymousJson(`${publicPath()}?fileId=${privateFileId}`, 404)
        await anonymousJson(contentPath(privateFileId), 404)
        const response = await publicGet(contentPath(firstId))
        assert.equal(response.status(), 200)
        assert.equal(await response.text(), firstContent)
        assert.match(response.headers()['cache-control'], /private/)
        assert.match(response.headers()['content-disposition'], /env\.template/)
        const metadata = await publicGet(folderPath())
        assert.match(metadata.headers()['cache-control'], /no-store/)
      }
    )

    await check(
      'public folder navigation keeps file previews separate and downloads exact filenames',
      async () => {
        await sql`update workspace_files set updated_at = '2026-01-01T00:00:00Z' where id in (${firstId}, ${secondId})`
        await visitor.goto(new URL(`/f/${token}`, baseUrl).href, { waitUntil: 'domcontentloaded' })
        await visitor.getByRole('button', { name: 'Nested shared', exact: true }).click()
        await visitor.getByRole('button', { name: 'env.template', exact: true }).click()
        await visitor.getByText('FOLDER_FIRST_PREVIEW=one', { exact: false }).waitFor()
        const downloadPromise = visitor.waitForEvent('download')
        await visitor.getByRole('button', { name: 'Download', exact: true }).click()
        assert.equal((await downloadPromise).suggestedFilename(), 'env.template')
        await visitor.getByRole('button', { name: 'Nested shared', exact: true }).click()
        await visitor.getByRole('button', { name: 'env.example', exact: true }).click()
        await visitor.getByText('FOLDER_SECOND_PREVIEW=two', { exact: false }).waitFor()
        assert.equal(
          await visitor.getByText('FOLDER_FIRST_PREVIEW=one', { exact: false }).count(),
          0
        )
        await visitor.screenshot({ path: join(reportDirectory, 'public-folder-preview.png') })
      }
    )

    await check(
      'folder previews scope embedded images to the current document and genuine raster bytes',
      async () => {
        const inlinePath = `${publicPath()}/inline?documentId=${docId}`
        const raster = await publicGet(`${inlinePath}&fileId=${rasterId}`)
        assert.equal(raster.status(), 200)
        assert.equal(raster.headers()['content-type'], 'image/png')
        assert.match(raster.headers()['cache-control'], /no-store/)
        await anonymousJson(`${inlinePath}&fileId=${unreferencedId}`, 404)
        await anonymousJson(`${inlinePath}&fileId=${forgedId}`, 404)
        await anonymousJson(`${publicPath()}/inline?documentId=${firstId}&fileId=${rasterId}`, 404)
        await anonymousJson(
          `${publicPath()}/inline?documentId=${privateFileId}&fileId=${rasterId}`,
          404
        )
      }
    )

    await check(
      'folder capabilities paginate forwards and backwards with at most 100 visible entries',
      async () => {
        const records = Array.from({ length: 205 }, (_, index) => ({
          id: generateId(),
          workspace_id: fixture.workspaceId,
          user_id: fixture.ownerId,
          folder_id: rootId,
          key: `workspace/${fixture.workspaceId}/page-${index}`,
          original_name: `page-${String(index).padStart(3, '0')}.txt`,
          content_type: 'text/plain',
          size_bytes: 1,
          context: 'workspace',
        }))
        await sql`insert into workspace_files ${sql(records)}`
        const first = await anonymousJson(folderPath())
        assert(Array.isArray(first.entries))
        assert.equal(first.entries.length, 100)
        assert.equal(first.previousCursor, null)
        assert.equal(typeof first.nextCursor, 'string')
        const second = await anonymousJson(`${folderPath()}?cursor=${first.nextCursor}`)
        assert(Array.isArray(second.entries))
        assert.equal(second.entries.length, 100)
        const third = await anonymousJson(`${folderPath()}?cursor=${second.nextCursor}`)
        assert(Array.isArray(third.entries))
        assert.equal(third.entries.length, 6)
        assert.equal(third.nextCursor, null)
        const back = await anonymousJson(`${folderPath()}?cursor=${second.previousCursor}`)
        assert.deepEqual(back.entries, first.entries)
        const ids = [...first.entries, ...second.entries, ...third.entries].map((entry) => {
          assert(isRecordLike(entry))
          return entry.id
        })
        assert.equal(new Set(ids).size, 206)
        await anonymousJson(`${folderPath()}?folderId=${childId}&cursor=${first.nextCursor}`, 400)
        await anonymousJson(`${folderPath()}?cursor=malformed`, 400)
        await visitor.goto(new URL(`/f/${token}`, baseUrl).href, { waitUntil: 'domcontentloaded' })
        await visitor.getByRole('button', { name: 'Next', exact: true }).click()
        await visitor
          .getByRole('button', { name: 'page-098.txt', exact: true })
          .waitFor({ state: 'hidden' })
        await visitor.getByRole('button', { name: 'page-099.txt', exact: true }).waitFor()
        assert.equal(await visitor.locator('tbody tr').count(), 100)
        await visitor.getByRole('button', { name: 'Previous', exact: true }).click()
        await visitor.getByRole('button', { name: 'Nested shared', exact: true }).waitFor()
        assert.equal(await visitor.locator('tbody tr').count(), 100)
      }
    )

    await check(
      'moving or archiving an ancestor immediately revokes its descendant file reads',
      async () => {
        await sql`update folder set parent_id = ${privateId} where id = ${childId}`
        try {
          await anonymousJson(contentPath(firstId), 404)
          await anonymousJson(`${folderPath()}?folderId=${childId}`, 404)
        } finally {
          await sql`update folder set parent_id = ${rootId} where id = ${childId}`
        }
        await sql`update folder set deleted_at = now() where id = ${childId}`
        try {
          await anonymousJson(contentPath(firstId), 404)
        } finally {
          await sql`update folder set deleted_at = null where id = ${childId}`
        }
      }
    )

    await check(
      'folder password cookies are enforced and invalidated by password rotation',
      async () => {
        await updateShare({
          isActive: true,
          authType: 'password',
          password: 'synthetic-folder-password-one',
        })
        await anonymousJson(folderPath(), 401)
        await anonymousJson(contentPath(firstId), 401)
        const html = await publicGet(`/f/${token}`)
        assert.equal(html.status(), 200)
        assert(
          !(await html.text()).includes('Sharing fixture'),
          'Protected folder name leaked in HTML metadata'
        )
        const denied = await anonymous.request.post(new URL(publicPath(), baseUrl).href, {
          timeout: 180_000,
          data: { password: 'wrong-synthetic-password' },
        })
        assert.equal(denied.status(), 401)
        const accepted = await anonymous.request.post(new URL(publicPath(), baseUrl).href, {
          timeout: 180_000,
          data: { password: 'synthetic-folder-password-one' },
        })
        assert.equal(accepted.status(), 200)
        assert.equal((await publicGet(folderPath())).status(), 200)
        await updateShare({
          isActive: true,
          authType: 'password',
          password: 'synthetic-folder-password-two',
        })
        assert.equal((await publicGet(folderPath())).status(), 401)
      }
    )

    await check(
      'folder email and SSO modes reject the wrong identity and preserve existing auth protocols',
      async () => {
        const ownerEmail = `files-e2e-${fixture.ownerId}@files-e2e.test`
        await updateShare({ isActive: true, authType: 'email', allowedEmails: [ownerEmail] })
        await anonymousJson(folderPath(), 401)
        await json(`${publicPath()}/otp`, {
          method: 'PUT',
          authenticated: false,
          body: { email: 'denied@files-e2e.test', otp: '123456' },
          expected: 403,
        })
        const verificationId = generateId()
        await sql`insert into verification (id, identifier, value, expires_at, created_at, updated_at)
        values (${verificationId}, ${`file-otp:${shareId}:${ownerEmail}`}, '123456:0', now() + interval '10 minutes', now(), now())`
        try {
          const verified = await anonymous.request.put(
            new URL(`${publicPath()}/otp`, baseUrl).href,
            { data: { email: ownerEmail, otp: '123456' }, timeout: 180_000 }
          )
          assert.equal(verified.status(), 200)
          assert.equal((await publicGet(folderPath())).status(), 200)
          await updateShare({
            isActive: true,
            authType: 'email',
            allowedEmails: ['other@files-e2e.test'],
          })
          assert.equal((await publicGet(folderPath())).status(), 401)
        } finally {
          await sql`delete from verification where id = ${verificationId}`
        }
        await updateShare({ isActive: true, authType: 'sso', allowedEmails: [ownerEmail] })
        await anonymousJson(folderPath(), 401)
        await json(folderPath())
        await updateShare({
          isActive: true,
          authType: 'sso',
          allowedEmails: ['other@files-e2e.test'],
        })
        await json(folderPath(), { expected: 401 })
        await updateShare({ isActive: true, authType: 'public' })
      }
    )

    await check(
      'original file-share URLs remain usable and cannot be widened to a folder',
      async () => {
        const result = await json(`${filesPath}/${firstId}/share`, {
          method: 'PUT',
          body: { isActive: true },
        })
        assert(isRecordLike(result.share) && typeof result.share.token === 'string')
        const directPath = `/api/files/public/${result.share.token}`
        const metadata = await anonymousJson(directPath)
        assert.equal(metadata.name, 'env.template')
        const response = await publicGet(`${directPath}/content`)
        assert.equal(await response.text(), firstContent)
        await anonymousJson(`${directPath}/folder`, 404)
        await anonymousJson(`${directPath}?fileId=${secondId}`, 404)
      }
    )

    for (const view of ['folder', 'file'] as const) {
      await check(`cached ${view} data stays hidden while authorization is rechecked`, async () => {
        const location = new URL(`/f/${token}`, baseUrl)
        location.searchParams.set('folder-id', childId)
        if (view === 'file') location.searchParams.set('file-id', firstId)
        await visitor.goto(location.href, { waitUntil: 'domcontentloaded' })
        if (view === 'file') {
          await visitor.getByText('FOLDER_FIRST_PREVIEW=one', { exact: false }).waitFor()
        } else {
          await visitor.getByRole('button', { name: 'env.template', exact: true }).waitFor()
        }
        const release = createDeferred<void>()
        const authorizationRequest = (url: URL) =>
          url.pathname === (view === 'folder' ? folderPath() : publicPath())
        await visitor.route(authorizationRequest, async (route) => {
          await release.promise
          await route.continue()
        })
        try {
          if (view === 'folder') {
            await updateShare({ isActive: false })
          } else {
            await sql`update workspace_files set folder_id = ${privateId} where id = ${firstId}`
          }
          const pending = visitor.waitForRequest((request) =>
            authorizationRequest(new URL(request.url()))
          )
          const folderRechecked =
            view === 'file'
              ? visitor.waitForResponse(
                  (response) =>
                    new URL(response.url()).pathname === folderPath() && response.status() === 200
                )
              : Promise.resolve()
          await visitor.evaluate(() => {
            window.dispatchEvent(new Event('offline'))
            window.dispatchEvent(new Event('online'))
          })
          await pending
          const checkedListing = await folderRechecked
          if (checkedListing) {
            await checkedListing.finished()
            await visitor.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                )
            )
          }
          await visitor.getByRole('status').filter({ hasText: 'Loading…' }).waitFor()
          assert.equal(await visitor.locator('tbody tr').count(), 0)
          assert.equal(
            await visitor.getByText('FOLDER_FIRST_PREVIEW=one', { exact: false }).count(),
            0
          )
          assert.equal(
            await visitor.getByRole('button', { name: 'Download', exact: true }).count(),
            0
          )
          assert.equal(await visitor.getByText('env.template', { exact: true }).count(), 0)
          await visitor.screenshot({
            path: join(reportDirectory, `public-${view}-revalidation.png`),
          })
          const denied = visitor.waitForResponse(
            (response) => authorizationRequest(new URL(response.url())) && response.status() === 404
          )
          release.resolve()
          await denied
          await visitor.getByText('This shared content is unavailable.', { exact: true }).waitFor()
        } finally {
          release.resolve()
          await visitor.unroute(authorizationRequest)
          if (view === 'folder') {
            await updateShare({ isActive: true })
          } else {
            await sql`update workspace_files set folder_id = ${childId} where id = ${firstId}`
          }
        }
      })
    }

    await check(
      'disabled folder sharing revokes listing, metadata, bytes, and cached browser navigation',
      async () => {
        await updateShare({ isActive: false })
        await anonymousJson(folderPath(), 404)
        await anonymousJson(`${publicPath()}?fileId=${firstId}`, 404)
        await anonymousJson(contentPath(firstId), 404)
        await visitor.reload({ waitUntil: 'domcontentloaded' })
        assert.equal(
          await visitor.getByRole('button', { name: 'Nested shared', exact: true }).count(),
          0
        )
        await updateShare({ isActive: true })
        const result = await json(sharePath)
        assert(isRecordLike(result.share))
        assert.equal(result.share.token, token)
        assert.equal(result.share.id, shareId)
        assert.deepEqual(browserErrors, [])
      }
    )
  } finally {
    try {
      await anonymous.tracing.stop({
        path: join(reportDirectory, 'public-folder-browser-trace.zip'),
      })
    } finally {
      try {
        await anonymous.close()
      } finally {
        await sql.begin(async (tx) => {
          await tx`delete from api_key where id in (${workspaceKeyId}, ${personalKeyId})`
          await tx`delete from workspace where id = ${foreignWorkspaceId}`
          await tx`delete from "user" where id = ${readerId}`
          await tx`delete from rate_limit_bucket where key in (
            ${`route:workspace-folder-sharing:${readerId}`},
            ${`route:workspace-folder-sharing:${fixture.ownerId}`}
          )`
        })
      }
    }
  }
}
