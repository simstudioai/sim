import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { dropPaths, uploadMenuTrigger } from '@/scripts/files-e2e/browser'
import type { FilesE2EContext } from '@/scripts/files-e2e/types'

/** Exercises cancellation while native readers and real upload requests are in flight. */
export async function runUploadLifecycleChecks(context: FilesE2EContext, directory: string) {
  const { fixture, sql, page, baseUrl, check } = context
  await page.goto(new URL(`/workspace/${fixture.workspaceId}/files`, baseUrl).href, {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('input[webkitdirectory]').waitFor({ state: 'attached' })
  await uploadMenuTrigger(page).and(page.locator(':enabled')).waitFor()

  await check(
    'cancel releases a delayed native directory read and permits a new upload',
    async () => {
      const root = join(directory, 'Canceled traversal')
      await mkdir(join(root, 'Nested'), { recursive: true })
      await writeFile(join(root, 'Nested', 'must-not-upload.txt'), 'Canceled directory contents\n')
      const recovery = join(directory, 'after-reader-cancel.txt')
      await writeFile(recovery, 'Reader cancellation recovered\n')
      const reader = await page.evaluateHandle(() => {
        const pending: (() => void)[] = []
        let calls = 0
        let released = false
        let prototype: FileSystemDirectoryReader | undefined
        let original: FileSystemDirectoryReader['readEntries'] | undefined
        const interceptDrop = (event: DragEvent) => {
          if (prototype) return
          for (const item of Array.from(event.dataTransfer?.items ?? [])) {
            const entry = item.webkitGetAsEntry()
            if (!entry?.isDirectory) continue
            const nativeReader = (entry as FileSystemDirectoryEntry).createReader()
            const readerPrototype = Object.getPrototypeOf(nativeReader) as FileSystemDirectoryReader
            const readEntries = readerPrototype.readEntries
            prototype = readerPrototype
            original = readEntries
            readerPrototype.readEntries = function (success, failure) {
              calls += 1
              readEntries.call(
                this,
                (entries) => {
                  if (released) success(entries)
                  else pending.push(() => success(entries))
                },
                failure
              )
            }
            break
          }
        }
        window.addEventListener('drop', interceptDrop, true)
        return {
          get calls() {
            return calls
          },
          get pending() {
            return pending.length
          },
          release() {
            released = true
            for (const finish of pending.splice(0)) finish()
          },
          restore() {
            window.removeEventListener('drop', interceptDrop, true)
            if (prototype && original) prototype.readEntries = original
          },
        }
      })
      try {
        await dropPaths(page, [root])
        const deadline = Date.now() + 10_000
        while ((await reader.evaluate((value) => value.pending)) === 0) {
          assert(Date.now() < deadline, 'The native directory read never reached the held callback')
          await sleep(50)
        }
        await uploadMenuTrigger(page, 'Preparing…').click()
        await page.getByRole('menuitem', { name: 'Cancel upload', exact: true }).click()
        await uploadMenuTrigger(page).waitFor({ timeout: 3000 })
        await dropPaths(page, [recovery])
        const uploaded = Date.now() + 120_000
        while (true) {
          const rows =
            await sql`select id from workspace_files where workspace_id = ${fixture.workspaceId}
          and original_name = 'after-reader-cancel.txt'`
          if (rows.length === 1) break
          assert(Date.now() < uploaded, 'A delayed canceled reader blocked a new upload')
          await sleep(200)
        }
        await reader.evaluate((value) => value.release())
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        )
        assert.equal(
          await reader.evaluate((value) => value.calls),
          1,
          'Canceled traversal read another directory'
        )
        const rows = await sql`select id from folder where workspace_id = ${fixture.workspaceId}
        and name = 'Canceled traversal'`
        assert.equal(rows.length, 0, 'Canceled traversal created its folder tree')
      } finally {
        await reader.evaluate((value) => {
          value.release()
          value.restore()
        })
        await reader.dispose()
      }
    }
  )

  await check(
    'losing edit access aborts active and queued uploads before further requests',
    async () => {
      const names = ['access-active.txt', 'access-next.txt', 'access-queued.txt']
      const paths = names.map((name) => join(directory, name))
      for (const path of paths) await writeFile(path, 'Access revocation must stop this upload\n')
      const replacementOwner = generateId()
      const email = `files-e2e-replacement-${replacementOwner}@files-e2e.test`
      await sql`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${replacementOwner}, 'Replacement owner', ${email}, ${email}, true, now(), now())`
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let requests = 0
      const pattern = '**/api/files/uploads'
      await page.route(pattern, async (route) => {
        requests += 1
        if (requests === 1) await gate
        await route.continue().catch(() => {})
      })
      try {
        await uploadMenuTrigger(page).waitFor()
        await dropPaths(page, paths.slice(0, 2))
        const deadline = Date.now() + 30_000
        while (requests === 0) {
          assert(Date.now() < deadline, 'The first upload did not reach its HTTP boundary')
          await sleep(50)
        }
        await dropPaths(page, [paths[2]])
        await sql.begin(async (tx) => {
          await tx`update workspace set owner_id = ${replacementOwner} where id = ${fixture.workspaceId}`
          await tx`update member set role = 'member' where user_id = ${fixture.ownerId} and organization_id = ${fixture.orgId}`
          await tx`update permissions set permission_type = 'read' where user_id = ${fixture.ownerId}
          and entity_type = 'workspace' and entity_id = ${fixture.workspaceId}`
        })
        await page.clock.setFixedTime(Date.now() + 60_000)
        await page.evaluate(() => {
          window.dispatchEvent(new Event('offline'))
          window.dispatchEvent(new Event('online'))
        })
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll('button')).some(
            (button) => button.textContent?.trim() === 'New folder' && button.disabled
          )
        )
        release()
        await uploadMenuTrigger(page).waitFor({ timeout: 5000 })
        assert.equal(requests, 1, 'The batch issued more uploads after edit access was revoked')
        const rows =
          await sql`select id from workspace_files where workspace_id = ${fixture.workspaceId}
        and original_name = any(${names})`
        assert.equal(rows.length, 0, 'An upload persisted after edit access was revoked')
      } finally {
        release()
        await page.unroute(pattern)
        await page.clock.setSystemTime(Date.now())
        await sql.begin(async (tx) => {
          await tx`update workspace set owner_id = ${fixture.ownerId} where id = ${fixture.workspaceId}`
          await tx`update member set role = 'owner' where user_id = ${fixture.ownerId} and organization_id = ${fixture.orgId}`
          await tx`update permissions set permission_type = 'admin' where user_id = ${fixture.ownerId}
          and entity_type = 'workspace' and entity_id = ${fixture.workspaceId}`
          await tx`delete from "user" where id = ${replacementOwner}`
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
      }
    }
  )
}
