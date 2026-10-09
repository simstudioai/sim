import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import type { FilesE2EContext } from '@/scripts/files-e2e/types'

/** Exercises the largest practical sibling picker without materializing its options in the DOM. */
export async function runNavigationScaleChecks(context: FilesE2EContext) {
  const { fixture, sql, page, baseUrl, reportDirectory, check, json } = context
  const name = 'Navigation scale'
  const created = await json(`/api/workspaces/${fixture.workspaceId}/files/folders`, {
    method: 'POST',
    body: { name, parentId: null },
  })
  assert(isRecordLike(created.folder) && typeof created.folder.id === 'string')
  const folderId = created.folder.id
  const childPrefix = generateId()
  await sql`insert into folder (id, workspace_id, user_id, resource_type, name, parent_id)
    select ${childPrefix} || '-' || position, ${fixture.workspaceId}, ${fixture.ownerId},
      'file', 'Wide child ' || lpad(position::text, 5, '0'), ${folderId}
    from generate_series(0, 8999) as children(position)`
  const location = (id: string) =>
    new URL(`/workspace/${fixture.workspaceId}/files?folderId=${id}`, baseUrl).href
  try {
    await page.goto(location(folderId), { waitUntil: 'domcontentloaded' })
    const picker = (label: string) =>
      page.getByRole('combobox', { name: `Navigate within ${label}`, exact: true })

    await check(
      'a 9000-child breadcrumb picker mounts only its visible option window',
      async () => {
        const start = performance.now()
        await picker(name).click()
        await page.getByRole('option', { name: 'Wide child 00000', exact: true }).waitFor()
        const mountedOptions = await page.getByRole('option').count()
        const openDurationMs = Math.round(performance.now() - start)
        await page.keyboard.press('Escape')
        const warmStart = performance.now()
        await picker(name).click()
        await page.getByRole('option', { name: 'Wide child 00000', exact: true }).waitFor()
        const warmOpenDurationMs = Math.round(performance.now() - warmStart)
        await writeFile(
          join(reportDirectory, 'folder-picker-scale.json'),
          `${JSON.stringify({ childCount: 9000, mountedOptions, openDurationMs, warmOpenDurationMs }, null, 2)}\n`
        )
        assert(mountedOptions <= 50, `Picker mounted ${mountedOptions} options for 9000 children`)
        await page.screenshot({ path: join(reportDirectory, 'folder-picker-scale.png') })
        await page.keyboard.press('Escape')
      }
    )

    await check(
      'large folder pickers preserve rename, sharing, search, and keyboard navigation',
      async () => {
        await picker(name).click()
        await page.getByRole('option', { name: 'Rename folder', exact: true }).click()
        const rename = await page.locator(`input[value="${name}"]`).elementHandle()
        assert(rename, 'The current folder must expose its inline rename input')
        const renamed = `${name} renamed`
        await rename.fill(renamed)
        assert.equal(
          await picker(name).count(),
          0,
          'Folder actions must remain unavailable while a rename draft is being edited'
        )
        await rename.press('Enter')
        const deadline = Date.now() + 60_000
        while (true) {
          const [row] = await sql`select name from folder where id = ${folderId}`
          if (row?.name === renamed) break
          assert(Date.now() < deadline, 'Renaming through the folder picker did not persist')
          await sleep(200)
        }
        await picker(renamed).click()
        await page.getByRole('option', { name: 'Share folder', exact: true }).click()
        await page.getByRole('dialog').waitFor()
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        await picker(renamed).click()
        await page.getByPlaceholder('Find folder...').fill('Wide child 08999')
        await page.getByRole('option', { name: 'Wide child 08999', exact: true }).waitFor()
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await page.waitForURL(location(`${childPrefix}-8999`))
      }
    )
  } finally {
    await sql`delete from folder where workspace_id = ${fixture.workspaceId} and (id = ${folderId} or parent_id = ${folderId})`
  }
  await page.goto(new URL(`/workspace/${fixture.workspaceId}/files`, baseUrl).href, {
    waitUntil: 'domcontentloaded',
  })
}
