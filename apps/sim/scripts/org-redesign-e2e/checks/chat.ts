import assert from 'node:assert/strict'
import { sleep } from '@sim/utils/helpers'
import {
  ADMIN,
  ADMIN_CHATS,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  MEMBER_CHATS,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  notProvable,
  orgUrl,
  section,
  sql,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import { composer, dialog, menuEntry, searchField } from '@/scripts/org-redesign-e2e/locators'

export async function chatChecks() {
  section('3 Chat')
  await check("Share and the feedback form on a chat are the design system's dialogs", async () => {
    const inSurface = (dialogLocator: ReturnType<typeof dialog>) =>
      expect(
        dialogLocator.page().locator('[data-platform-ui]').filter({ has: dialogLocator })
      ).not.toHaveCount(0)
    const fileId = '6f1f4a52-8e0b-4d7a-9a13-0d5d3c1b7e21'
    await sql`insert into workspace_files (id, key, user_id, workspace_id, context, original_name, content_type, size_bytes)
      values (${fileId}, ${`workspace/${fileId}.md`}, ${ADMIN.userId}, ${MEMBER_ADMIN_WORKSPACE.id}, 'workspace', 'share-check.md', 'text/markdown', 1)`
    await sql`update copilot_chats
      set resources = ${sql.json([
        {
          type: 'file',
          id: fileId,
          title: 'share-check.md',
          workspaceId: MEMBER_ADMIN_WORKSPACE.id,
        },
      ])}
      where id = ${ADMIN_CHATS.agent.id}`
    try {
      await withSession(ADMIN, async ({ page }) => {
        await page.route('**/api/files/serve/**', (route) =>
          route.fulfill({ body: '# Share check' })
        )
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}?resource=${fileId}`))
        await page.getByRole('button', { name: 'Share file', exact: true }).click()
        const share = dialog(page, 'Share share-check.md')
        await inSurface(share)
        await expect(share.getByRole('group', { name: 'File access' })).toBeVisible()
        await share.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(share).toHaveCount(0)
        await page.getByRole('button', { name: 'Rate response', exact: true }).click()
        await menuEntry(page, 'Bad response').click()
        const feedback = dialog(page, 'Share feedback')
        await inSurface(feedback)
        await expect(feedback.getByRole('textbox', { name: 'Details' })).toHaveValue('')
        await feedback.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(feedback).toHaveCount(0)
      })
    } finally {
      await sql`update copilot_chats set resources = '[]'::jsonb where id = ${ADMIN_CHATS.agent.id}`
      await sql`delete from workspace_files where id = ${fileId}`
    }
  })
  await check(
    'assistant conversation under Search: switch, New chat, follow-up composer',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
        const views = page.getByRole('navigation', { name: 'Search views' })
        await expect(views.getByRole('button', { name: 'Assistant', exact: true })).toHaveAttribute(
          'aria-current',
          'page'
        )
        await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeVisible()
        await expect(composer(page)).toHaveAttribute('placeholder', 'Ask a follow-up')
        await expect(
          page
            .getByRole('button', { name: 'Attach image' })
            .or(page.getByRole('button', { name: 'Add resources' }))
        ).toBeHidden()
        await page.getByRole('button', { name: 'New chat', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/search?mode=assistant'))
      })
    }
  )
  await check(
    'a stream survives switching to the Search view: Assistant stays mounted, inert',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/search?mode=assistant'))
        await composer(page).fill('Count slowly from 1 to 50, one number per line.')
        await composer(page).press('Enter')
        await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
        const stop = page.getByRole('button', { name: 'Stop generation' })
        await expect(stop).toBeVisible()
        const views = page.getByRole('navigation', { name: 'Search views' })
        await views.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(page).toHaveURL((address) => address.searchParams.get('mode') === 'search')
        await expect(searchField(page)).toBeVisible()
        await expect(
          page.locator('[inert]').getByRole('textbox', { name: 'Ask Sim', includeHidden: true })
        ).toHaveCount(1)
        await sleep(2_500)
        await views.getByRole('button', { name: 'Assistant', exact: true }).click()
        await expect(stop).toBeVisible()
        await expect(page.getByText(/(^|\s)4(\s|$)/).first()).toBeVisible()
        await stop.click()
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
          timeout: 30_000,
        })
      })
    }
  )
  await check('a message during a turn steers it, without a second turn', async () => {
    await withSession(MEMBER, async ({ page }) => {
      const turns: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith('/api/mothership/chat'))
          turns.push(request.postDataJSON().message)
      })
      await page.goto(orgUrl('/search?mode=assistant'))
      await composer(page).fill('Count slowly from 1 to 50, one number per line.')
      await composer(page).press('Enter')
      await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible({
        timeout: 30_000,
      })
      await composer(page).fill('And then say done.')
      const steered = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/copilot/chat/steer')
      )
      await composer(page).press('Enter')
      const steer = await steered
      assert.equal(steer.status(), 200)
      assert.equal(steer.request().postDataJSON().content, 'And then say done.')
      await expect(composer(page)).toHaveValue('')
      await expect(page.getByText('And then say done.', { exact: true })).toBeVisible()
      await expect(page.getByText('Applied: And then say done.')).toBeVisible({ timeout: 30_000 })
      await page.getByRole('button', { name: 'Stop generation' }).click()
      await expect(page.getByText('And then say done.', { exact: true })).toHaveCount(1)
      assert.deepEqual(turns, ['Count slowly from 1 to 50, one number per line.'])
    })
  })
  await check(
    'a message the turn ends without applying goes out as the next turn',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        const turns: string[] = []
        page.on('request', (request) => {
          if (request.method() === 'POST' && request.url().endsWith('/api/mothership/chat'))
            turns.push(request.postDataJSON().message)
        })
        await page.goto(orgUrl('/search?mode=assistant'))
        await composer(page).fill('Count slowly to 3 and ignore steering.')
        await composer(page).press('Enter')
        await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible({
          timeout: 30_000,
        })
        await composer(page).fill('Then say done.')
        await composer(page).press('Enter')
        await expect(page.getByText('Then say done.', { exact: true })).toBeVisible()
        await expect(page.getByText('Hello from the scripted agent.')).toBeVisible({
          timeout: 30_000,
        })
        await expect(page.getByText('Then say done.', { exact: true })).toHaveCount(1)
        assert.deepEqual(turns, ['Count slowly to 3 and ignore steering.', 'Then say done.'])
      })
    },
    /* The turn's end can reach the page before the chat's lock is released: the send is then
       refused once and retried, which the client handles without showing anything. */
    { allow: [/409 POST \/api\/(mothership\/chat|copilot\/chat\/steer)/] }
  )
  notProvable('Assistant action approval review cards', 'Covered by the assistant-actions suite')
  notProvable(
    'Citations, Sources panel, feedback',
    'Covered by organization-search, unchanged code'
  )
}
