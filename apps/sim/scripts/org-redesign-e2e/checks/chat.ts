import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { workspaceResourcePath } from '@/lib/resources/urls'
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
  org,
  section,
  sql,
  url,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  composer,
  dialog,
  hydrated,
  menuEntry,
  searchField,
} from '@/scripts/org-redesign-e2e/locators'

/** Search's view switch: a radio group in whichever view is showing. */
const modeRadio = (page: Page, name: 'Search' | 'Assistant') =>
  page.getByRole('group', { name: 'Search mode' }).getByRole('radio', { name, exact: true })
const assistantUrl = () => url(`${org.search}?${new URLSearchParams({ mode: 'assistant' })}`)
const conversation = (page: Page) => page.getByRole('region', { name: 'Conversation' })
const stopResponse = (page: Page) => page.getByRole('button', { name: 'Stop response' })

export async function chatChecks() {
  section('3 Chat')
  await check(
    "a chat's file opens where it is shared, and the feedback form is a dialog",
    async () => {
      const fileId = '6f1f4a52-8e0b-4d7a-9a13-0d5d3c1b7e21'
      const filePath = workspaceResourcePath(MEMBER_ADMIN_WORKSPACE.id, 'file', fileId)
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
          await page.goto(
            url(`${org.chat(ADMIN_CHATS.agent.id)}?${new URLSearchParams({ resource: fileId })}`)
          )
          await expect(
            conversation(page).getByText(`Here is what I found about ${ADMIN_CHATS.agent.title}.`)
          ).toBeVisible()

          await page.getByRole('button', { name: 'Rate response', exact: true }).click()
          await menuEntry(page, 'Bad response').click()
          const feedback = dialog(page, 'Share feedback')
          await expect(feedback.getByRole('textbox', { name: 'Details' })).toHaveValue('')
          await feedback.getByRole('button', { name: 'Cancel', exact: true }).click()
          await expect(feedback).toHaveCount(0)

          // The panel links a file out to its workspace page, which is where it is shared.
          const panel = page.getByRole('complementary', { name: 'Chat panel' })
          const open = panel.getByRole('link', { name: 'Open share-check.md' })
          const openPanel = page.getByRole('button', { name: 'Open chat panel' })
          await hydrated(page)
          if (await openPanel.isVisible()) await openPanel.click()
          await expect(open).toBeVisible()
          await expect(open).toHaveAttribute('href', filePath)
          await page.goto(url(filePath))
          await page.getByRole('main').getByRole('button', { name: 'Share', exact: true }).click()
          const share = dialog(page, 'Share share-check.md')
          await expect(share.getByRole('group', { name: 'File access' })).toBeVisible()
          await share.getByRole('button', { name: 'Cancel', exact: true }).click()
          await expect(share).toHaveCount(0)
        })
      } finally {
        await sql`update copilot_chats set resources = '[]'::jsonb where id = ${ADMIN_CHATS.agent.id}`
        await sql`delete from workspace_files where id = ${fileId}`
      }
    }
  )
  await check(
    'assistant conversation under Search: switch, New chat, follow-up composer',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(url(org.searchChat(MEMBER_CHATS.assistant.id)))
        await expect(modeRadio(page, 'Assistant')).toBeChecked()
        await expect(composer(page)).toHaveAttribute('placeholder', 'Ask a follow-up…')
        // The Assistant takes images only: its attach button says so, and it offers no skills.
        await expect(page.getByRole('button', { name: 'Attach image', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Attach file', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Skills', exact: true })).toHaveCount(0)
        const newChat = page.getByRole('button', { name: 'New chat', exact: true })
        await expect(newChat).toBeVisible()
        await newChat.click()
        await expect(page).toHaveURL(assistantUrl())
      })
    }
  )
  await check(
    'a stream survives switching to the Search view: Assistant stays mounted, inert',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(assistantUrl())
        await composer(page).fill('Count slowly from 1 to 50, one number per line.')
        await composer(page).press('Enter')
        await expect(page).toHaveURL(
          (address) => address.pathname.startsWith(`${org.search}/chat/`),
          { timeout: 30_000 }
        )
        const stop = stopResponse(page)
        await expect(stop).toBeVisible()
        await modeRadio(page, 'Search').click()
        await expect(page).toHaveURL((address) => address.searchParams.get('mode') === 'search')
        await expect(searchField(page)).toBeVisible()
        // Still mounted, behind the Search view where nothing can reach it, and still streaming.
        const hidden = page.locator('[hidden]')
        await expect(hidden.locator('[data-elevation="composer"] textarea')).toHaveCount(1)
        await expect(hidden.getByText(/(^|\s)4(\s|$)/).first()).toBeAttached()
        await modeRadio(page, 'Assistant').click()
        await expect(stop).toBeVisible()
        await expect(
          conversation(page)
            .getByText(/(^|\s)4(\s|$)/)
            .first()
        ).toBeVisible()
        await stop.click()
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({
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
      await page.goto(assistantUrl())
      await composer(page).fill('Count slowly from 1 to 50, one number per line.')
      await composer(page).press('Enter')
      await expect(stopResponse(page)).toBeVisible({ timeout: 30_000 })
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
      await expect(
        conversation(page).getByText('And then say done.', { exact: true })
      ).toBeVisible()
      await expect(conversation(page).getByText('Applied: And then say done.')).toBeVisible({
        timeout: 30_000,
      })
      await stopResponse(page).click()
      await expect(conversation(page).getByText('And then say done.', { exact: true })).toHaveCount(
        1
      )
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
        await page.goto(assistantUrl())
        await composer(page).fill('Count slowly to 3 and ignore steering.')
        await composer(page).press('Enter')
        await expect(stopResponse(page)).toBeVisible({ timeout: 30_000 })
        await composer(page).fill('Then say done.')
        await composer(page).press('Enter')
        await expect(conversation(page).getByText('Then say done.', { exact: true })).toBeVisible()
        await expect(conversation(page).getByText('Hello from the scripted agent.')).toBeVisible({
          timeout: 30_000,
        })
        await expect(conversation(page).getByText('Then say done.', { exact: true })).toHaveCount(1)
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
