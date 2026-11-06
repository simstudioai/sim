import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { escapeRegExp } from '@sim/utils/string'
import type {
  HomeWidgetAccount,
  OrganizationHomeCalendar,
  OrganizationHomeEmail,
  OrganizationHomeWorkspaceActivity,
} from '@/lib/api/contracts/organization-home'
import {
  ADMIN,
  ADMIN_CHATS,
  CONNECTED,
  GRANTS,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  MEMBER_CHATS,
  MEMBER_WRITE_WORKSPACE,
  NARROW,
  ORGANIZATION_ID,
  OUTSIDE_ORGANIZATION_ID,
  OWNER,
  SEEDED_SOURCE,
  WORKSPACES,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  artifactDirectory,
  captureRequests,
  check,
  DESKTOP,
  expect,
  notProvable,
  onHome,
  orgUrl,
  origin,
  PHONE,
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
  homeRegion,
  pageTurn,
  searchField,
  sidebar,
} from '@/scripts/org-redesign-e2e/locators'
import {
  EMAIL_THREAD,
  FOUR_WAY_MEETINGS,
  fulfillContract,
  stubConnectedHome,
  stubSearch,
} from '@/scripts/org-redesign-e2e/stubs'

/**
 * Real signals for the Home Workspaces rows: a person-paused run in the member's write workspace, a
 * live run in their admin workspace, and a paused run in one they cannot open, which must not reach them.
 */
async function withWorkspaceActivity(run: () => Promise<void>) {
  const prefix = 'org-redesign-activity'
  const seeded = [
    { key: 'review', workspaceId: MEMBER_WRITE_WORKSPACE.id, name: 'Renewal approval' },
    { key: 'running', workspaceId: MEMBER_ADMIN_WORKSPACE.id, name: 'Invoice sync' },
    { key: 'hidden', workspaceId: WORKSPACES[4].id, name: 'Not for this member' },
  ]
  const cleanup = async () => {
    await sql`delete from workflow_execution_logs where id like ${`${prefix}-%`}`
    await sql`delete from workflow_execution_snapshots where id like ${`${prefix}-%`}`
    await sql`delete from workflow where id like ${`${prefix}-%`}`
  }
  try {
    for (const { key, workspaceId: scope, name } of seeded) {
      const workflowId = `${prefix}-${key}`
      await sql`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
        values (${workflowId}, ${OWNER.userId}, ${scope}, ${name}, now(), now(), now())`
      if (key === 'running') {
        await sql`insert into workflow_execution_snapshots (id, workflow_id, state_hash, state_data)
          values (${workflowId}, ${workflowId}, ${workflowId}, ${sql.json({})})`
        await sql`insert into workflow_execution_logs (id, workflow_id, workspace_id, execution_id, state_snapshot_id, level, status, trigger, started_at, execution_deadline_at)
          values (${workflowId}, ${workflowId}, ${scope}, ${workflowId}, ${workflowId}, 'info', 'running', 'api', now(), now() + interval '30 minutes')`
      } else {
        await sql`insert into paused_executions (id, workflow_id, execution_id, execution_snapshot, pause_points, total_pause_count)
          values (${workflowId}, ${workflowId}, ${workflowId}, ${sql.json({})}, ${sql.json({ approval: { resumeStatus: 'paused', pauseKind: 'human' } })}, 1)`
      }
    }
    await run()
  } finally {
    await cleanup()
  }
}

export async function homeChecks() {
  section('3 Home: member')
  await check(
    'Home renders the greeting, the Assistant composer, and no Build/Search picker',
    async () => {
      await onHome(MEMBER, async ({ page }) => {
        await expect(page).toHaveURL(orgUrl('/home'))
        await expect(page.getByRole('heading', { level: 1 })).toContainText(', Mia')
        await expect(page.getByText('Ask about your company’s knowledge.')).toBeVisible()
        await expect(composer(page)).toHaveAttribute('placeholder', 'Ask about your sources')
        await expect(
          page.locator('[data-platform-ui]').filter({ has: composer(page) })
        ).toHaveCount(0)
        await expect(page.getByRole('radio', { name: 'Search' })).toHaveCount(0)
        await expect(page.getByRole('combobox', { name: 'Conversation mode' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Add resources' })).toHaveCount(0)
      })
    }
  )
  await check(
    'the Assistant composer sends to the assistant route and lands under Search',
    async () => {
      await onHome(MEMBER, async ({ page }) => {
        await composer(page).fill('Say hello from Home')
        const posted = page.waitForRequest(
          (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
        )
        await composer(page).press('Enter')
        const body = (await posted).postDataJSON()
        assert.equal(body.mode, 'assistant')
        assert.equal(body.organizationId, ORGANIZATION_ID)
        assert.equal(body.createNewChat, true)
        assert.equal(body.message, 'Say hello from Home')
        await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
        await expect(page.getByText('Hello from the scripted agent.')).toBeVisible({
          timeout: 30_000,
        })
        const chatId = new URL(page.url()).pathname.split('/').at(-1)
        await expect(page.getByRole('navigation', { name: 'Search views' })).toBeVisible()
        await composer(page).fill('An unsent follow-up')
        await page
          .getByRole('navigation', { name: 'Search views' })
          .getByRole('button', { name: 'Search' })
          .click()
        await expect(page).toHaveURL(new RegExp(`/search/chat/${chatId}\\?mode=search`))
        await expect(searchField(page)).toBeVisible()
        await page
          .getByRole('navigation', { name: 'Search views' })
          .getByRole('button', { name: 'Assistant' })
          .click()
        await expect(page.getByText('Hello from the scripted agent.')).toBeVisible()
        await expect(
          sidebar(page)
            .getByRole('link', { name: /Scripted chat|Say hello/ })
            .first()
        ).toHaveAttribute('href', `${root}/search/chat/${chatId}`)
      })
    }
  )
  await check('New chat on a chat started from Home returns to an empty Home', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await composer(page).fill('Say hello again from Home')
      await composer(page).press('Enter')
      await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
      await page.getByRole('button', { name: 'New chat', exact: true }).click()
      await expect(page).toHaveURL(/\/home$/)
      await expect(composer(page)).toHaveValue('')
    })
  })
  await check('Home, Search and the agent keep separate drafts', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await composer(page).fill('A draft on Home')
      await page.goto(orgUrl('/search?mode=assistant'))
      await expect(composer(page)).toHaveValue('')
      await composer(page).fill('A draft in Search')
      await page.goto(orgUrl('/home'))
      await expect(composer(page)).toHaveValue('A draft on Home')
      await page.goto(orgUrl('/search?mode=assistant'))
      await expect(composer(page)).toHaveValue('A draft in Search')
      await page.goto(orgUrl('/home'))
      await composer(page).fill('')
    })
  })
  await check(
    'Email and Calendar prompt to connect, with only the providers on offer',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route('https://accounts.google.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
        )
        await page.goto(orgUrl('/home'))
        const email = homeRegion(page, 'Email')
        await expect(email.getByText('Connect your email', { exact: true })).toBeVisible()
        await expect(email.getByRole('button', { name: 'Gmail', exact: true })).toBeEnabled()
        await expect(email.getByRole('button', { name: 'Outlook', exact: true })).toHaveCount(0)
        const calendar = homeRegion(page, 'Calendar')
        await expect(calendar.getByText('Connect your calendar', { exact: true })).toBeVisible()
        await expect(
          calendar.getByRole('button', { name: 'Google Calendar', exact: true })
        ).toBeEnabled()
        const measureCard = async (region: Locator, provider: string) => {
          const [card, connect] = [
            await region.locator('[data-widget]').boundingBox(),
            await region.getByRole('button', { name: provider, exact: true }).boundingBox(),
          ]
          assert(card && connect, `The ${provider} card and its button are on screen`)
          assert(
            connect.y >= card.y && connect.y + connect.height <= card.y + card.height,
            `The ${provider} button leaves its card`
          )
          return card
        }
        const [mailCard, calendarCard] = [
          await measureCard(email, 'Gmail'),
          await measureCard(calendar, 'Google Calendar'),
        ]
        assert(
          calendarCard.height < mailCard.height,
          `Calendar ${calendarCard.height}px is meant to be the shorter card, beside Email ${mailCard.height}px`
        )
        await expect(calendar.getByRole('button', { name: 'Outlook', exact: true })).toHaveCount(0)
        const authorization = context.waitForEvent('request', (request) =>
          request.url().startsWith('https://accounts.google.com/')
        )
        await email.getByRole('button', { name: 'Gmail', exact: true }).click()
        const target = new URL((await authorization).url())
        assert.equal(target.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID)
      })
    }
  )
  await check('Connected members see their mail and schedule, and can change the day', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await stubConnectedHome(page)
      await page.goto(orgUrl('/home'))
      const email = homeRegion(page, 'Email')
      await expect(email.getByText('Parts recall notice')).toBeVisible()
      await expect(email.getByText('Connect your email')).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Calendar schedule' })).toBeVisible()
      const calendar = homeRegion(page, 'Calendar')
      const standup = calendar.getByText(/^Standup /)
      await expect(standup).toBeVisible()
      const today = await standup.innerText()
      await calendar.getByRole('button', { name: 'Next day', exact: true }).click()
      await expect(page).toHaveURL((address) => address.searchParams.has('day'))
      await expect(standup).not.toHaveText(today)
      await expect(standup).toBeVisible()
    })
  })
  for (const viewport of [DESKTOP, PHONE]) {
    for (const theme of ['light', 'dark'] as const) {
      await check(`Calendar cards never touch (${viewport.name} ${theme})`, async () => {
        await withSession(
          CONNECTED,
          async ({ page }) => {
            await stubConnectedHome(page)
            await page.goto(orgUrl('/home'))
            const schedule = page.getByRole('region', { name: 'Calendar schedule' })
            const cards = schedule.locator('article')
            await expect(cards.first()).toBeVisible()
            const overflow = schedule.getByRole('button', { name: /^\d+ more meetings$/ })
            await expect(overflow).toHaveCount(1)

            const drawn = await schedule
              .locator('article, button[aria-label$="more meetings"]')
              .evaluateAll((elements) =>
                elements.map((element) => {
                  const { left, right, top, bottom } = element.getBoundingClientRect()
                  return {
                    name: element.textContent ?? '',
                    left,
                    right,
                    top,
                    bottom,
                    clippedBy: element.scrollHeight - element.clientHeight,
                  }
                })
              )
            const touching = drawn.flatMap((first, index) =>
              drawn
                .slice(index + 1)
                .filter(
                  (second) =>
                    first.left < second.right + 2 &&
                    second.left < first.right + 2 &&
                    first.top < second.bottom + 2 &&
                    second.top < first.bottom + 2
                )
                .map((second) => `${first.name} / ${second.name}`)
            )
            assert.deepEqual(touching, [])
            assert.deepEqual(
              drawn.filter((card) => card.clippedBy > 1).map((card) => card.name),
              []
            )

            const shown = await cards.allInnerTexts()
            await overflow.focus()
            await page.keyboard.press('Enter')
            const offered = await page.getByRole('menuitem').allInnerTexts()
            assert.ok(offered.length > 0, 'the overflow opens from the keyboard')
            for (const title of FOUR_WAY_MEETINGS) {
              const reached = [...shown, ...offered].filter((text) => text.includes(title))
              assert.equal(reached.length, 1, `${title} is reachable exactly once`)
            }
            await page.keyboard.press('Escape')

            await schedule.evaluate((element) => {
              const first = element.querySelector('article')
              if (first instanceof HTMLElement) element.scrollTop = first.offsetTop
            })
            await homeRegion(page, 'Calendar').screenshot({
              path: resolve(artifactDirectory, `calendar__${viewport.name}__${theme}.png`),
              animations: 'disabled',
            })
          },
          { viewport, theme }
        )
      })
    }
  }
  await check('a run of day clicks reads the provider once, for the day it stops on', async () => {
    await withSession(CONNECTED, async (session) => {
      const { page } = session
      await stubConnectedHome(page)
      await page.goto(orgUrl('/home'))
      const calendar = homeRegion(page, 'Calendar')
      const standup = calendar.getByText(/^Standup /)
      await expect(standup).toBeVisible()
      await session.settle()
      session.requests.length = 0
      const next = calendar.getByRole('button', { name: 'Next day', exact: true })
      for (let click = 0; click < 4; click++)
        await next.evaluate((button: HTMLElement) => button.click())
      await expect(page).toHaveURL((address) => address.searchParams.has('day'))
      await expect(standup).toBeVisible()
      await session.settle()
      const day = new URL(page.url()).searchParams.get('day')
      await expect(standup).toHaveText(`Standup ${day}`)
      const reads = session.requests.filter(({ path }) =>
        path.includes(`/organizations/${ORGANIZATION_ID}/home/calendar`)
      )
      assert.equal(reads.length, 1, `A burst of days read ${reads.length} times`)
      assert(reads[0].path.includes(`date=${day}`), 'The read was not for the day shown')
    })
  })
  await check('a member gets no Tasks run chart rather than a broken one', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await expect(homeRegion(page, 'Email')).toBeVisible()
      await expect(homeRegion(page, 'Tasks run')).toHaveCount(0)
    })
  })
  await check('Recents list real history and × removes it for good', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const recents = homeRegion(page, 'Recents')
      const row = recents.getByRole('link', { name: SEEDED_SOURCE.title })
      await expect(row).toBeVisible()
      await row.hover()
      await recents
        .getByRole('button', { name: `Remove ${SEEDED_SOURCE.title} from recents` })
        .click()
      await expect(row).toHaveCount(0)
      await page.reload()
      await expect(homeRegion(page, 'Email')).toBeVisible()
      await expect(recents.getByRole('link', { name: SEEDED_SOURCE.title })).toHaveCount(0)
    })
  })
  await check('Unread chats need attention and open under Search', async () => {
    const { id, title } = MEMBER_CHATS.unread
    await withRestore(
      () => sql`update copilot_chats set last_seen_at = null where id = ${id}`,
      () =>
        withSession(MEMBER, async ({ page }) => {
          await sql`update copilot_chats set last_seen_at = null where id = ${id}`
          await page.goto(orgUrl('/home'))
          const row = homeRegion(page, 'Needs your attention').getByRole('link', { name: title })
          await expect(row).toHaveAttribute('href', `${root}/search/chat/${id}`)
          await row.click()
          await expect(page).toHaveURL(
            (address) => address.pathname === `${root}/search/chat/${id}`
          )
        })
    )
  })
  await check('Get started keeps its steps, with Integrations for a member', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const started = homeRegion(page, 'Get started')
      await expect(started.getByRole('link', { name: /Connect an integration/ })).toHaveAttribute(
        'href',
        `${root}/integrations`
      )
      await expect(started.getByRole('link', { name: /Sim Search MCP/ })).toBeVisible()
    })
  })
  await check('Customize Home hides a widget, and Undo brings it back', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Email')).toHaveCount(0)
      await page.getByRole('button', { name: 'Undo' }).click()
      await expect(homeRegion(page, 'Email')).toBeVisible()
    })
  })
  await check(
    "Workspaces lists only the member's workspaces, Review then Running, and opens like the rail",
    async () => {
      await withWorkspaceActivity(async () => {
        await withSession(MEMBER, async ({ page }) => {
          const reads: string[] = []
          page.on('request', (request) => {
            const { pathname } = new URL(request.url())
            if (pathname.includes('workspace-activity')) reads.push(pathname)
          })
          const answered = page.waitForResponse(/\/home\/workspace-activity$/)
          await page.goto(orgUrl('/home'))
          const body = await (await answered).text()
          assert(!body.includes(WORKSPACES[4].id), 'Another workspace reached the member')
          const rows = homeRegion(page, 'Workspaces').getByRole('link')
          await expect(rows).toHaveText([
            new RegExp(`${MEMBER_WRITE_WORKSPACE.name}.*Renewal approval.*Review`),
            new RegExp(`${MEMBER_ADMIN_WORKSPACE.name}.*Invoice sync.*Running`),
          ])
          await expect(homeRegion(page, 'Workspaces').getByText('Up to date')).toHaveCount(0)
          assert.deepEqual(
            reads,
            [`/api/organizations/${ORGANIZATION_ID}/home/workspace-activity`],
            'Home read workspace activity more than once'
          )
          await rows.nth(1).click()
          await expect(page).toHaveURL(
            (address) => address.pathname.startsWith(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}`),
            { timeout: 45_000 }
          )
        })
      })
    }
  )
  await check('a workspace with an old run says when, and claims no status', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.route(/\/home\/workspace-activity$/, (route) =>
        fulfillContract<OrganizationHomeWorkspaceActivity>(route, {
          workspaces: [
            {
              workspaceId: MEMBER_ADMIN_WORKSPACE.id,
              status: null,
              statusWorkflowName: null,
              lastRun: {
                workflowName: 'Invoice sync',
                startedAt: new Date(Date.now() - 2.5 * 60 * 60_000).toISOString(),
                failed: true,
              },
            },
            {
              workspaceId: MEMBER_WRITE_WORKSPACE.id,
              status: null,
              statusWorkflowName: null,
              lastRun: null,
            },
          ],
        })
      )
      await page.goto(orgUrl('/home'))
      const region = homeRegion(page, 'Workspaces')
      await expect(region.getByText('Last run failed: Invoice sync')).toBeVisible()
      await expect(region.getByText('2hrs ago')).toBeVisible()
      await expect(region.getByText('No recent workflow runs')).toBeVisible()
    })
  })
  await check(
    'Workspaces holds its rows while its read is out, and keeps them if it fails',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        const release = createDeferred<void>()
        let fail = true
        await page.route(/\/home\/workspace-activity$/, async (route) => {
          await release.promise
          if (fail) await route.fulfill({ status: 500, json: { error: 'stand-in' } })
          else await route.fallback()
        })
        await page.goto(orgUrl('/home'))
        const region = homeRegion(page, 'Workspaces')
        await expect(region.getByRole('status', { name: 'Loading workspaces' })).toBeVisible()
        await expect(
          region.getByRole('status', { name: 'Loading workspaces' }).locator('> span')
        ).toHaveCount(2)
        release.resolve()
        await expect(
          region.getByText('What these workspaces are doing could not load.')
        ).toBeVisible({ timeout: 30_000 })
        await expect(region.getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })).toBeVisible()
        fail = false
        await region.getByRole('button', { name: 'Retry' }).click()
        await expect(
          region.getByText('What these workspaces are doing could not load.')
        ).toHaveCount(0, { timeout: 30_000 })
      })
    },
    { allow: [/500 GET .*workspace-activity/] }
  )
  await check('Customize Home hides Workspaces across a reload, and stops its read', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await expect(homeRegion(page, 'Workspaces')).toBeVisible()
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Workspaces' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Workspaces')).toHaveCount(0)
      const reads = captureRequests(page, (request) =>
        request.url().includes('/home/workspace-activity')
      )
      await page.reload()
      await expect(composer(page)).toBeVisible()
      await expect(homeRegion(page, 'Workspaces')).toHaveCount(0)
      assert.deepEqual(reads, [], 'A hidden widget still read its activity')
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Workspaces' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Workspaces')).toBeVisible()
    })
  })
  await check('widget reads refuse another organization', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const response = await page.request.get(
        url(`/api/organizations/${OUTSIDE_ORGANIZATION_ID}/home/email`)
      )
      assert.equal(response.status(), 404)
    })
  })

  section('3 Home: narrow group')
  await check('A narrow group has Home with no dead Connect button', async () => {
    await withSession(NARROW, async ({ page, context }) => {
      await context.route('https://accounts.google.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
      )
      for (const [title, provider] of [
        ['Email', 'Gmail'],
        ['Calendar', 'Google Calendar'],
      ]) {
        await page.goto(orgUrl('/home'))
        const connect = homeRegion(page, title).getByRole('button', {
          name: provider,
          exact: true,
        })
        await expect(connect).toBeEnabled()
        const authorization = context.waitForEvent('request', (request) =>
          request.url().startsWith('https://accounts.google.com/')
        )
        await connect.click()
        await authorization
      }
    })
  })

  await check(
    'A member with no workspaces sees no Workspaces section and reads nothing',
    async () => {
      await withSession(NARROW, async ({ page }) => {
        const reads = captureRequests(page, (request) =>
          request.url().includes('/home/workspace-activity')
        )
        await page.goto(orgUrl('/home'))
        await expect(sidebar(page).getByText('No workspaces yet')).toBeVisible()
        await expect(homeRegion(page, 'Workspaces')).toHaveCount(0)
        await page.getByRole('button', { name: 'Customize Home' }).click()
        await expect(page.getByRole('menuitemcheckbox', { name: 'Email' })).toBeVisible()
        await expect(page.getByRole('menuitemcheckbox', { name: 'Workspaces' })).toHaveCount(0)
        assert.deepEqual(reads, [], 'A member with no workspaces read workspace activity')
      })
    }
  )
  section('3 Home: admin')
  await check('the chart reads the window it shows, and going back reads nothing', async () => {
    await withSession(ADMIN, async (session) => {
      const { page } = session
      await page.goto(orgUrl('/home'))
      const chart = homeRegion(page, 'Tasks run')
      await expect(chart.locator('[data-plot="home-activity"]')).toBeVisible()
      await session.settle()
      const reads = () =>
        session.requests
          .map(({ path }) => path)
          .filter((path) => path.includes('/usage/activity/summary'))
      const days = (path: string) => {
        const query = new URL(path, origin).searchParams
        return (
          (Date.parse(String(query.get('endDate'))) - Date.parse(String(query.get('startDate')))) /
            86_400_000 +
          1
        )
      }
      assert.deepEqual(reads().map(days), [7], 'Home did not read the default window alone')
      const choose = async (from: string, to: string) => {
        await chart.getByRole('button', { name: `Range: ${from}` }).click()
        await page.getByRole('menuitemradio', { name: to }).click()
        await expect(chart.getByRole('button', { name: `Range: ${to}` })).toBeVisible()
        await expect(chart.locator('[data-plot="home-activity"]')).toBeVisible()
        await session.settle()
      }
      await choose('Last 7 days', 'Last 30 days')
      assert.deepEqual(reads().map(days), [7, 30], 'A wider range was not read once')
      await choose('Last 30 days', 'Last 7 days')
      assert.deepEqual(reads().map(days), [7, 30], 'A narrower range read again')
    })
  })
  await check('an admin pages through Workspaces the way the rail does', async () => {
    await onHome(ADMIN, async ({ page }) => {
      const region = homeRegion(page, 'Workspaces')
      await expect(region.getByRole('link')).toHaveCount(5)
      await region.getByRole('button', { name: 'See more' }).click()
      await expect.poll(() => region.getByRole('link').count()).toBeGreaterThan(5)
      await region.getByRole('button', { name: 'See less' }).click()
      await expect(region.getByRole('link')).toHaveCount(5)
    })
  })
  await check('the workspace activity read refuses another organization', async () => {
    await onHome(ADMIN, async ({ page }) => {
      const response = await page.request.get(
        url(`/api/organizations/${OUTSIDE_ORGANIZATION_ID}/home/workspace-activity`)
      )
      assert.equal(response.status(), 404)
    })
  })
  await check(
    'the agent composer with its tools and the Tasks run chart, without Suggested actions',
    async () => {
      await onHome(ADMIN, async ({ page }) => {
        await expect(page).toHaveURL(orgUrl('/home'))
        await expect(page.getByRole('heading', { level: 1 })).toContainText(', Ada')
        await expect(composer(page)).toBeVisible()
        await expect(
          page.locator('[data-platform-ui]').filter({ has: composer(page) })
        ).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Add resources' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Attach file' })).toBeVisible()
        await expect(page.getByRole('button', { name: /Skills/ }).first()).toBeVisible()
        await expect(page.getByText('Suggested actions', { exact: true })).toHaveCount(0)
        await expect(homeRegion(page, 'Tasks run')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      })
    }
  )
  await check('an agent turn streams, keeps its route, and Stop ends it', async () => {
    await onHome(ADMIN, async ({ page }) => {
      await composer(page).fill('Count slowly from 1 to 50, one number per line.')
      const posted = page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
      )
      await composer(page).press('Enter')
      const body = (await posted).postDataJSON()
      assert.equal(body.mode ?? 'agent', 'agent')
      await expect(page).toHaveURL(/\/chat\/[^/?]+/, { timeout: 30_000 })
      const stop = page.getByRole('button', { name: 'Stop generation' })
      await expect(stop).toBeVisible()
      await stop.click()
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
        timeout: 30_000,
      })
    })
  })
  await check(
    'Assistant hides the resource toggle until a resource; a builder always has it',
    async () => {
      const toggle = (page: Page, action: 'Expand' | 'Collapse') =>
        page.getByRole('button', { name: `${action} resource view`, exact: true })
      await onHome(MEMBER, async ({ page }) => {
        await expect(composer(page)).toBeVisible()
        await expect(page.getByRole('button', { name: /resource view/ })).toHaveCount(0)
      })
      await withSession(ADMIN, async ({ page }) => {
        await stubSearch(page)
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expect(composer(page)).toBeVisible()
        await page.goto(orgUrl('/home'))
        await expect(composer(page)).toBeVisible()
        await expect(toggle(page, 'Expand')).toHaveCount(0)
        await page.goBack()
        await toggle(page, 'Expand').click()
        await expect(
          page.getByRole('button', { name: 'Add resource tab', exact: true })
        ).toBeVisible()
        await toggle(page, 'Collapse').click()
        const resource = encodeURIComponent(`search:organization:${ORGANIZATION_ID}`)
        await page.goto(orgUrl(`/home?q=parts&resource=${resource}`))
        await toggle(page, 'Collapse').click()
        await toggle(page, 'Expand').click()
        await expect(toggle(page, 'Collapse')).toBeVisible()
      })
    }
  )
  await check("on a phone a builder's empty chat keeps the toggle in its own row", async () => {
    await withSession(
      ADMIN,
      async ({ page }) => {
        const anyToggle = page.getByRole('button', { name: /resource view/ })
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expect(composer(page)).toBeVisible()
        await expect(anyToggle).toBeVisible()
        const firstMessage = page.getByText(/^About /).first()
        await expect(firstMessage).toBeVisible()
        const toggleBox = await anyToggle.boundingBox()
        const messageBox = await firstMessage.boundingBox()
        assert(toggleBox && messageBox, 'The toggle and the first message are both laid out')
        assert(
          messageBox.y >= toggleBox.y + toggleBox.height,
          "The transcript starts below the toggle's row"
        )
      },
      { viewport: PHONE }
    )
    await onHome(
      MEMBER,
      async ({ page }) => {
        await expect(composer(page)).toBeVisible()
        await expect(page.getByRole('button', { name: /resource view/ })).toHaveCount(0)
      },
      { viewport: PHONE }
    )
  })
  await check('a /skill or @mention sent before its list lands waits for the list', async () => {
    await withSession(ADMIN, async ({ page }) => {
      const skillsHeld = createDeferred<void>()
      await page.route(/\/api\/skills/, async (route) => {
        await skillsHeld.promise
        await route.continue()
      })
      const sends = captureRequests(
        page,
        (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
      )
      await page.goto(orgUrl('/home'))
      await composer(page).fill('/review this')
      await composer(page).press('Enter')
      await expect(page.locator('[aria-busy="true"]').filter({ has: composer(page) })).toHaveCount(
        1
      )
      await expect(composer(page)).toBeEditable()
      await expect(page.locator('[inert]').filter({ has: composer(page) })).toHaveCount(0)
      await pageTurn(page)
      assert.deepEqual(sends, [], 'The message waits for the skill lists')
      skillsHeld.resolve()
      await expect.poll(() => sends.length, { timeout: 30_000 }).toBeGreaterThan(0)
    })
    await withSession(ADMIN, async ({ page }) => {
      const listsHeld = createDeferred<void>()
      await page.route(/\/api\/(workflows|table|knowledge)/, async (route) => {
        await listsHeld.promise
        await route.continue()
      })
      await page.goto(orgUrl('/home'))
      await composer(page).click()
      await composer(page).pressSequentially('@op')
      const loading = page.getByText('Loading resources', { exact: true })
      await expect(loading).toBeVisible()
      // The open `@` menu is modal, which hides the field from role queries while it keeps focus.
      const field = page.locator('textarea[aria-label="Ask Sim"]')
      await expect(field).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(field).toHaveValue('@op')
      await expect(loading).toBeVisible()
      await page.keyboard.type('e')
      await expect(field).toHaveValue('@ope')
      listsHeld.resolve()
      await expect(loading).toHaveCount(0)
      await page.keyboard.press('Enter')
      await expect(field).toHaveValue(/Operations/)
    })
  })
  await check('the handoff search params restore a results tab on Home', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await stubSearch(page)
      await page.goto(orgUrl('/home?q=parts'))
      await expect(composer(page)).toBeVisible()
      await expect(page.getByText('Service bulletin', { exact: true }).first()).toBeVisible()
    })
  })
  notProvable('Plan chip', 'Only for platform superusers, which needs a platform admin fixture')
  notProvable('Mic with permission help', 'Headless Chromium exposes no speech recognition to test')
}

export async function homeFailureChecks() {
  section('3 Home: failure states')
  const SECOND_ACCOUNT = 'second@org-redesign.test'
  const widgetAccount = (state: HomeWidgetAccount['state'], displayName = CONNECTED.email) => ({
    credentialId: displayName === CONNECTED.email ? GRANTS.gmail.credentialId : 'second-account',
    displayName,
    state,
  })
  const homeRead = (widget: 'email' | 'calendar') =>
    `**/api/organizations/${ORGANIZATION_ID}/home/${widget}**`
  const refusedRead = (widget: 'email' | 'calendar') =>
    refused(500, 'GET', `/api/organizations/${ORGANIZATION_ID}/home/${widget}`)

  await check('an email account that needs reauthorizing asks to reconnect', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await stubConnectedHome(page)
      await page.route(homeRead('email'), (route) =>
        fulfillContract<OrganizationHomeEmail>(route, {
          accounts: [widgetAccount('needs_reauth')],
          threads: [],
        })
      )
      await page.goto(orgUrl('/home'))
      const email = homeRegion(page, 'Email')
      await expect(email.getByText('Reconnect your email', { exact: true })).toBeVisible()
      await expect(email.getByText('No email yet')).toHaveCount(0)
    })
  })
  await check('one unreachable account keeps the mail that did load, and retries', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await stubConnectedHome(page)
      let reads = 0
      await page.route(homeRead('email'), (route) => {
        reads += 1
        return fulfillContract<OrganizationHomeEmail>(route, {
          accounts: [widgetAccount('ready'), widgetAccount('unavailable', SECOND_ACCOUNT)],
          threads: [EMAIL_THREAD()],
        })
      })
      await page.goto(orgUrl('/home'))
      const email = homeRegion(page, 'Email')
      await expect(email.getByText(EMAIL_THREAD().subject)).toBeVisible()
      await expect(email.getByText(`${SECOND_ACCOUNT} could not be reached.`)).toBeVisible()
      const before = reads
      await email.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect.poll(() => reads).toBeGreaterThan(before)
    })
  })
  await check(
    'a failed email read says so, and Retry recovers it',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await stubConnectedHome(page)
        let failing = true
        await page.route(homeRead('email'), (route) =>
          failing ? route.fulfill({ status: 500, json: { error: 'stand-in' } }) : route.fallback()
        )
        await page.goto(orgUrl('/home'))
        const email = homeRegion(page, 'Email')
        await expect(email.getByText('Your email could not load.')).toBeVisible({ timeout: 40_000 })
        failing = false
        await email.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(email.getByText(EMAIL_THREAD().subject)).toBeVisible()
      })
    },
    { allow: [refusedRead('email')] }
  )
  await check(
    'a failed calendar read fails its day alone, and Retry recovers it',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await stubConnectedHome(page)
        let failing = true
        await page.route(homeRead('calendar'), (route) =>
          failing ? route.fulfill({ status: 500, json: { error: 'stand-in' } }) : route.fallback()
        )
        await page.goto(orgUrl('/home'))
        const calendar = homeRegion(page, 'Calendar')
        await expect(calendar.getByText('This day could not load.')).toBeVisible({
          timeout: 40_000,
        })
        await expect(homeRegion(page, 'Email').getByText(EMAIL_THREAD().subject)).toBeVisible()
        failing = false
        await calendar.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(calendar.getByText(/^Standup /)).toBeVisible()
      })
    },
    { allow: [refusedRead('calendar')] }
  )
  await check('a calendar account that needs reauthorizing keeps the other schedule', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await stubConnectedHome(page)
      await page.route(homeRead('calendar'), (route) => {
        const date = new Date().toISOString().slice(0, 10)
        return fulfillContract<OrganizationHomeCalendar>(route, {
          accounts: [
            { ...widgetAccount('ready'), credentialId: GRANTS['google-calendar'].credentialId },
            widgetAccount('needs_reauth', SECOND_ACCOUNT),
          ],
          window: { startAt: `${date}T00:00:00.000Z`, endAt: `${date}T23:59:59.000Z` },
          events: [],
        })
      })
      await page.goto(orgUrl('/home'))
      await expect(
        homeRegion(page, 'Calendar').getByText(
          new RegExp(
            `${escapeRegExp(SECOND_ACCOUNT)} is paused|Reconnect ${escapeRegExp(SECOND_ACCOUNT)}`
          )
        )
      ).toBeVisible()
    })
  })
}
