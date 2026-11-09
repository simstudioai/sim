import assert from 'node:assert/strict'
import {
  ADMIN,
  ADMIN_CHATS,
  MEMBER,
  MEMBER_CHATS,
  NARROW,
  OUTSIDER,
  OWNER,
  PASSWORD,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  notProvable,
  onHome,
  org,
  refused,
  section,
  sql,
  url,
  withRestore,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  composer,
  expectPageNotFound,
  railLink,
  searchField,
} from '@/scripts/org-redesign-e2e/locators'

export async function landingChecks() {
  section('1 Where they land')
  // A member who cannot build has no Home: they land on Search, and their chats open under it
  // (platform/docs/org-parity.md:18, :255, :348). Builders still land on Home.
  const landsOnSearch = (address: URL) => address.pathname === org.search
  await check('a member who cannot build signs in to Search', async () => {
    await withSession(null, async ({ page }) => {
      await page.goto(url('/login'))
      await page.locator('#email').fill(MEMBER.email)
      await page.locator('#password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      // Polled rather than awaited as a navigation: /home streams its redirect, which Next answers
      // with both a client navigation and a meta refresh, and the one that loses is aborted.
      await expect.poll(() => landsOnSearch(new URL(page.url())), { timeout: 45_000 }).toBe(true)
      await expect(searchField(page)).toBeVisible()
    })
  })
  for (const persona of [ADMIN, OWNER]) {
    await check(`${persona.key}: /o and /o/[id] and /home reach Home`, async () => {
      await withSession(persona, async ({ page }) => {
        for (const path of ['/o', org.root, '/home']) {
          await page.goto(url(path))
          await expect(page).toHaveURL(url(org.home))
        }
        await expect(composer(page)).toBeVisible()
      })
    })
  }
  for (const persona of [MEMBER, NARROW]) {
    await check(`${persona.key}: /o and /o/[id] and /home reach Search`, async () => {
      await withSession(persona, async ({ page }) => {
        for (const path of ['/o', org.root, '/home', org.home]) {
          await page.goto(url(path))
          await expect(page).toHaveURL(landsOnSearch)
        }
        await expect(searchField(page)).toBeVisible()
      })
    })
  }
  await check('member: Search first load pins the saved mode into the URL', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(url(org.search))
      await expect(page).toHaveURL(url(`${org.search}?mode=search`))
      await expect(searchField(page)).toBeVisible()
    })
  })
  await check("a member's assistant chat opens under Search, from /chat too", async () => {
    await withSession(MEMBER, async ({ page }) => {
      const reply = page.getByText(`Here is what I found about ${MEMBER_CHATS.assistant.title}.`)
      await page.goto(url(org.chat(MEMBER_CHATS.assistant.id)))
      await expect(page).toHaveURL((address) => address.pathname.startsWith(org.search))
      await page.goto(url(org.searchChat(MEMBER_CHATS.assistant.id)))
      await expect(page).toHaveURL(url(org.searchChat(MEMBER_CHATS.assistant.id)))
      await expect(reply).toBeVisible()
    })
  })
  await check(
    "a member's agent chat lands on Search or is not found, unread, and renders for an admin",
    async () => {
      await withSession(MEMBER, async (session) => {
        const { page } = session
        const transcript = page.getByText(`Here is what I found about ${MEMBER_CHATS.agent.title}.`)
        // Agent routes send a member who cannot build to Search before any chat is read.
        await page.goto(url(org.chat(MEMBER_CHATS.agent.id)))
        await expect(page).toHaveURL(landsOnSearch)
        await expect(searchField(page)).toBeVisible()
        await expect(transcript).toHaveCount(0)
        // Search only opens assistant chats, so an agent chat there is absent, as in legacy.
        await page.goto(url(org.searchChat(MEMBER_CHATS.agent.id)))
        await expectPageNotFound(page)
        await expect(transcript).toHaveCount(0)
        await withRestore(
          () =>
            sql`update copilot_chats set last_seen_at = now() where id = ${MEMBER_CHATS.agent.id}`,
          async () => {
            await sql`update copilot_chats set last_seen_at = null where id = ${MEMBER_CHATS.agent.id}`
            await page.goto(url(org.search))
            await expect(railLink(page, MEMBER_CHATS.assistant.title)).toBeVisible()
            await session.settle()
            await expect(railLink(page, MEMBER_CHATS.agent.title)).toHaveCount(0)
          }
        )
      })
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(url(org.searchChat(ADMIN_CHATS.agent.id)))
        await expect(page).toHaveURL(url(org.chat(ADMIN_CHATS.agent.id)))
        await expect(
          page.getByText(`Here is what I found about ${ADMIN_CHATS.agent.title}.`)
        ).toBeVisible()
      })
    },
    {
      // The member's own agent chat, which Search does not open.
      allow: [refused(404, 'GET', org.searchChat(MEMBER_CHATS.agent.id))],
    }
  )
  await check(
    'a chat that is not theirs, or in another organization, never opens',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(url(org.chat(ADMIN_CHATS.agent.id)))
        await expect(page).toHaveURL(landsOnSearch)
        await expect(
          page.getByText(`Here is what I found about ${ADMIN_CHATS.agent.title}.`)
        ).toHaveCount(0)
        await page.goto(url(org.searchChat(ADMIN_CHATS.assistant.id)))
        await expectPageNotFound(page)
        await page.getByRole('button', { name: 'Return home', exact: true }).click()
        await expect(page).toHaveURL(landsOnSearch)
        await expect(searchField(page)).toBeVisible()
      })
    },
    {
      // Someone else's assistant chat, which must read as absent.
      allow: [refused(404, 'GET', org.searchChat(ADMIN_CHATS.assistant.id))],
    }
  )
  await check('signed out, every organization route goes to login', async () => {
    await withSession(null, async ({ page }) => {
      for (const path of [
        org.home,
        org.simLinks,
        `${org.integrations}?connectorType=gmail&provider=gmail&connectionMode=live&optionId=gmail`,
      ]) {
        await page.goto(url(path))
        await expect(page).toHaveURL((address) => address.pathname === '/login')
      }
    })
  })
  notProvable(
    'Signed out: callbackUrl keeps the org root or page',
    'proxy.ts answers a cookieless request with a bare /login first; unchanged from staging'
  )
  await check('a non-member sees the denial and a way to their workspaces', async () => {
    await onHome(OUTSIDER, async ({ page }) => {
      const heading = page.getByRole('heading', { name: 'Organization access denied' })
      await expect(heading).toBeVisible()
      await expect(page.getByRole('button', { name: 'View your workspaces' })).toBeVisible()
      // The other route states center in the page; this one sat at the top.
      const box = await heading.boundingBox()
      const viewport = page.viewportSize()
      assert.ok(box && viewport, 'Nothing to measure')
      assert.ok(
        box.y > viewport.height / 4,
        `The denial sits at ${Math.round(box.y)}px of a ${viewport.height}px page`
      )
    })
  })
  await check(
    'settings redirects and aliases resolve, and unavailable sections are not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        const location = page.getByLabel('Settings location')
        // Bare Settings opens General in place; the product does not rewrite the URL.
        await page.goto(url(org.settings))
        await expect(location).toContainText('General')
        await page.goto(url(org.settingsSection('authorized-apps')))
        await expect(page).toHaveURL(
          (address) =>
            address.pathname === org.settingsSection('general') &&
            address.searchParams.get('view') === 'authorized-apps'
        )
        await page.goto(url(org.settingsSection('team')))
        await expect(page).toHaveURL(
          (address) => address.pathname === org.settingsSection('members')
        )
        await expect(page.getByRole('searchbox', { name: 'Search members' })).toBeVisible()
        await page.goto(url(org.accessRequests))
        await expect(page).toHaveURL(
          (address) => address.pathname === org.settingsSection('requests')
        )
        await page.goto(url(org.settingsSection('audit-logs')))
        await expectPageNotFound(page)
      })
    },
    // Audit logs is the one section a member may not open here.
    { allow: [refused(404, 'GET', org.settingsSection('audit-logs'))] }
  )
  await check(
    'People is not found with its flag off, and bad Integrations params are not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(url(org.people))
        await expectPageNotFound(page)
        await page.goto(url(`${org.integrations}?connectorType=not-a-connector`))
        await expectPageNotFound(page)
        await page.goto(url(`${org.integrations}?slack=!!`))
        await expectPageNotFound(page)
      })
    },
    {
      // The flag-off page and the two malformed queries this check opens.
      allow: [
        refused(404, 'GET', org.people),
        refused(404, 'GET', `${org.integrations}?connectorType=not-a-connector`),
        refused(404, 'GET', `${org.integrations}?slack=!!`),
      ],
    }
  )
}
