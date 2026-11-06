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
  orgUrl,
  refused,
  root,
  section,
  sql,
  url,
  withRestore,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  composer,
  expectPageNotFound,
  homeRegion,
  railLink,
  searchField,
} from '@/scripts/org-redesign-e2e/locators'

export async function landingChecks() {
  section('1 Where they land')
  await check('a member signing in lands on Home, not Search', async () => {
    await withSession(null, async ({ page }) => {
      await page.goto(url('/login'))
      await page.locator('#email').fill(MEMBER.email)
      await page.locator('#password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/home'), { timeout: 45_000 })
      await expect(composer(page)).toBeVisible()
    })
  })
  for (const persona of [MEMBER, ADMIN, OWNER, NARROW]) {
    await check(
      `${persona.key}: /o and /o/[id] and /home reach Home with no Search redirect`,
      async () => {
        await withSession(persona, async ({ page }) => {
          for (const path of ['/o', root, '/home']) {
            await page.goto(url(path))
            await expect(page).toHaveURL(orgUrl('/home'))
          }
          await expect(composer(page)).toBeVisible()
        })
      }
    )
  }
  await check('member: Search first load pins the saved mode into the URL', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/search'))
      await expect(page).toHaveURL(orgUrl('/search?mode=search'))
      await expect(searchField(page)).toBeVisible()
    })
  })
  await check('assistant chats redirect into Search from /chat', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl(`/chat/${MEMBER_CHATS.assistant.id}`))
      await expect(page).toHaveURL(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
      await expect(
        page.getByText(`Here is what I found about ${MEMBER_CHATS.assistant.title}.`)
      ).toBeVisible()
    })
  })
  await check(
    'an agent chat is not found for a member and renders for an admin',
    async () => {
      await withSession(MEMBER, async (session) => {
        const { page } = session
        await page.goto(orgUrl(`/chat/${MEMBER_CHATS.agent.id}`))
        await expectPageNotFound(page)
        await page.goto(orgUrl(`/search/chat/${MEMBER_CHATS.agent.id}`))
        await expectPageNotFound(page)
        await withRestore(
          () =>
            sql`update copilot_chats set last_seen_at = now() where id = ${MEMBER_CHATS.agent.id}`,
          async () => {
            await sql`update copilot_chats set last_seen_at = null where id = ${MEMBER_CHATS.agent.id}`
            await page.goto(orgUrl('/home'))
            await expect(railLink(page, MEMBER_CHATS.assistant.title)).toBeVisible()
            await session.settle()
            await expect(railLink(page, MEMBER_CHATS.agent.title)).toHaveCount(0)
            await expect(
              homeRegion(page, 'Needs your attention').getByText(MEMBER_CHATS.agent.title)
            ).toHaveCount(0)
          }
        )
      })
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl(`/search/chat/${ADMIN_CHATS.agent.id}`))
        await expect(page).toHaveURL(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expect(
          page.getByText(`Here is what I found about ${ADMIN_CHATS.agent.title}.`)
        ).toBeVisible()
      })
    },
    {
      // The member's own agent chat, on both of its routes.
      allow: [
        refused(404, 'GET', `${root}/chat/${MEMBER_CHATS.agent.id}`),
        refused(404, 'GET', `${root}/search/chat/${MEMBER_CHATS.agent.id}`),
      ],
    }
  )
  await check(
    'a chat that is not theirs, or in another organization, is not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expectPageNotFound(page)
        await page.goto(orgUrl(`/search/chat/${ADMIN_CHATS.assistant.id}`))
        await expectPageNotFound(page)
        await page.getByRole('link', { name: 'Return home', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/home'))
        await expect(composer(page)).toBeVisible()
      })
    },
    {
      // Someone else's chats, which must read as absent.
      allow: [
        refused(404, 'GET', `${root}/chat/${ADMIN_CHATS.agent.id}`),
        refused(404, 'GET', `${root}/search/chat/${ADMIN_CHATS.assistant.id}`),
      ],
    }
  )
  await check('signed out, every organization route goes to login', async () => {
    await withSession(null, async ({ page }) => {
      for (const path of [
        '/home',
        '/links',
        '/integrations?connectorType=gmail&provider=gmail&connectionMode=live&optionId=gmail',
      ]) {
        await page.goto(orgUrl(`${path}`))
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
      await expect(page.getByRole('heading', { name: 'Organization access denied' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'View your workspaces' })).toBeVisible()
    })
  })
  await check(
    'settings redirects and aliases resolve, and unavailable sections are not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/settings'))
        await expect(page).toHaveURL(orgUrl('/settings/general'))
        await page.goto(orgUrl('/settings/authorized-apps'))
        await expect(page).toHaveURL(
          (address) =>
            address.pathname === `${root}/settings/general` &&
            address.searchParams.get('view') === 'authorized-apps'
        )
        await page.goto(orgUrl('/settings/team'))
        await expect(page.getByPlaceholder('Search members…')).toBeVisible()
        await page.goto(orgUrl('/access-requests'))
        await expect(page).toHaveURL((address) => address.pathname === `${root}/settings/requests`)
        await page.goto(orgUrl('/settings/audit-logs'))
        await expectPageNotFound(page)
      })
    },
    // Audit logs is the one section a member may not open here.
    { allow: [refused(404, 'GET', `${root}/settings/audit-logs`)] }
  )
  await check(
    'People is not found with its flag off, and bad Integrations params are not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/people'))
        await expectPageNotFound(page)
        await page.goto(orgUrl('/integrations?connectorType=not-a-connector'))
        await expectPageNotFound(page)
        await page.goto(orgUrl('/integrations?slack=!!'))
        await expectPageNotFound(page)
      })
    },
    {
      // The flag-off page and the two malformed queries this check opens.
      allow: [
        refused(404, 'GET', `${root}/people`),
        refused(404, 'GET', `${root}/integrations?connectorType=not-a-connector`),
        refused(404, 'GET', `${root}/integrations?slack=!!`),
      ],
    }
  )
}
