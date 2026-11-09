import assert from 'node:assert/strict'
import type { Locator, Page } from '@playwright/test'
import { createDeferred } from '@sim/testing/helpers/deferred'
import type { OrganizationHomeWorkspaceActivity } from '@/lib/api/contracts/organization-home'
import {
  ADMIN,
  ADMIN_CHATS,
  CONNECTED,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  MEMBER_WRITE_WORKSPACE,
  NARROW,
  ORGANIZATION_ID,
  OUTSIDE_ORGANIZATION_ID,
  OWNER,
  SEEDED_SOURCE,
  WORKSPACES,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  captureRequests,
  check,
  expect,
  notProvable,
  onHome,
  org,
  origin,
  PHONE,
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
import { fulfillContract, stubSearch } from '@/scripts/org-redesign-e2e/stubs'

/** The Search page's Search/Assistant switch, a radio group in the page header. */
const searchMode = (page: Page, mode: 'Search' | 'Assistant') =>
  page.getByRole('group', { name: 'Search mode' }).getByRole('radio', { name: mode })
/** The conversation's control for its resource panel: Open and Close chat panel. */
const panelToggle = (page: Page, action: 'Open' | 'Close') =>
  page.getByRole('button', { name: `${action} chat panel`, exact: true })
const anyPanelToggle = (page: Page) =>
  page.getByRole('button', { name: /^(Open|Close) chat panel$/ })
/** The composer's own field, which an open `@` menu hides from role queries while it keeps focus. */
const composerField = (page: Page) => page.locator('[data-elevation="composer"] textarea')
const homeUrl = url(org.home)
const assistantSearchUrl = url(`${org.search}?mode=assistant`)

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
  section('3 Home: members who cannot build')
  // A member who cannot build has no Home: /home, the nav and Back to app take them to Search, and
  // their Assistant chats open under it (platform/docs/org-parity.md:18, :255, :348). The Home
  // behaviour those cases proved runs below for a builder; what only a member's Home showed (its
  // Assistant greeting, Get started, the connected member's widgets and their failure states, the
  // narrow group's Connect buttons) is dropped with it.
  for (const persona of [MEMBER, CONNECTED, NARROW]) {
    await check(`${persona.key}: /home lands on Search, with no Home to customize`, async () => {
      await onHome(persona, async ({ page }) => {
        await expect(page).toHaveURL((address) => address.pathname === org.search)
        await expect(searchField(page)).toBeVisible()
        await expect(page.getByRole('button', { name: 'Customize Home' })).toHaveCount(0)
        await expect(
          page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', {
            name: 'Home',
            exact: true,
          })
        ).toHaveCount(0)
      })
    })
  }
  await check(
    'the Assistant composer sends to the assistant route and lands under Search',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(assistantSearchUrl)
        await composer(page).fill('Say hello from the Assistant')
        const posted = page.waitForRequest(
          (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
        )
        await composer(page).press('Enter')
        const body = (await posted).postDataJSON()
        assert.equal(body.mode, 'assistant')
        assert.equal(body.organizationId, ORGANIZATION_ID)
        assert.equal(body.createNewChat, true)
        assert.equal(body.message, 'Say hello from the Assistant')
        await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
        await expect(page.getByText('Hello from the scripted agent.')).toBeVisible({
          timeout: 30_000,
        })
        const chatId = new URL(page.url()).pathname.split('/').at(-1)
        assert(chatId, 'The chat has an id in its URL')
        await expect(searchMode(page, 'Assistant')).toBeChecked()
        await composer(page).fill('An unsent follow-up')
        await searchMode(page, 'Search').click()
        await expect(page).toHaveURL(new RegExp(`/search/chat/${chatId}\\?mode=search`))
        await expect(searchField(page)).toBeVisible()
        await searchMode(page, 'Assistant').click()
        await expect(page.getByText('Hello from the scripted agent.')).toBeVisible()
        await expect(
          sidebar(page)
            .getByRole('link', { name: /Scripted chat|Say hello/ })
            .first()
        ).toHaveAttribute('href', org.searchChat(chatId))
      })
    }
  )
  await check("workspace activity reaches a member only for the member's workspaces", async () => {
    await withWorkspaceActivity(async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(url(org.search))
        const response = await page.request.get(
          url(`/api/organizations/${ORGANIZATION_ID}/home/workspace-activity`)
        )
        assert.equal(response.status(), 200)
        const body = await response.text()
        assert(!body.includes(WORKSPACES[4].id), 'Another workspace reached the member')
        assert(body.includes(MEMBER_WRITE_WORKSPACE.id), "The member's own workspace is missing")
      })
    })
  })
  await check('a member with no workspaces reads no workspace activity', async () => {
    await withSession(NARROW, async ({ page }) => {
      const reads = captureRequests(page, (request) =>
        request.url().includes('/home/workspace-activity')
      )
      await page.goto(homeUrl)
      await expect(page).toHaveURL((address) => address.pathname === org.search)
      await expect(sidebar(page).getByText('No workspaces yet')).toBeVisible()
      assert.deepEqual(reads, [], 'A member with no workspaces read workspace activity')
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

  section('3 Home: builder')
  // Home's own behaviour, for a viewer who has Home. These ran as a member before Home was limited
  // to builders (platform/docs/org-parity.md:255).
  await check('Home, Search and the agent keep separate drafts', async () => {
    await onHome(ADMIN, async ({ page }) => {
      await composer(page).fill('A draft on Home')
      await page.goto(assistantSearchUrl)
      await expect(composer(page)).toHaveValue('')
      await composer(page).fill('A draft in Search')
      await page.goto(homeUrl)
      await expect(composer(page)).toHaveValue('A draft on Home')
      await page.goto(assistantSearchUrl)
      await expect(composer(page)).toHaveValue('A draft in Search')
      await page.goto(homeUrl)
      await composer(page).fill('')
    })
  })
  await check(
    'Email and Calendar prompt to connect, with only the providers on offer',
    async () => {
      await withSession(ADMIN, async ({ page, context }) => {
        await context.route('https://accounts.google.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
        )
        await page.goto(homeUrl)
        const email = homeRegion(page, 'Email')
        await expect(email.getByText('Connect your email', { exact: true })).toBeVisible()
        await expect(email.getByRole('button', { name: 'Gmail', exact: true })).toBeEnabled()
        await expect(email.getByRole('button', { name: 'Outlook', exact: true })).toHaveCount(0)
        const calendar = homeRegion(page, 'Calendar')
        await expect(calendar.getByText('Connect your calendar', { exact: true })).toBeVisible()
        await expect(
          calendar.getByRole('button', { name: 'Google Calendar', exact: true })
        ).toBeEnabled()
        // Both boxes come from one frame: Home's widgets paint as their reads land, so the column
        // can move between two separate reads.
        const measureCard = async (region: Locator, provider: string) => {
          const { card, connect } = await region
            .getByRole('button', { name: provider, exact: true })
            .evaluate(
              (button, section) => {
                const box = (node: Element) => {
                  const { x, y, width, height } = node.getBoundingClientRect()
                  return width && height ? { x, y, width, height } : null
                }
                return { card: box(section), connect: box(button) }
              },
              await region.elementHandle()
            )
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
        // Both prompts fill the shared widget height (connected-widget.module.css), so neither card
        // stands taller than the other wherever the columns place them.
        assert.equal(
          calendarCard.height,
          mailCard.height,
          `Calendar ${calendarCard.height}px and Email ${mailCard.height}px are meant to share the widget height`
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
  await check('Recents list real history and × removes it for good', async () => {
    // Search's history check reads the same seeded visit later, so the removal is put back.
    const [before] =
      await sql`select sources from organization_search_history where user_id = ${ADMIN.userId} and organization_id = ${ORGANIZATION_ID}`
    await withRestore(
      () =>
        sql`update organization_search_history set sources = ${sql.json(before?.sources ?? [])} where user_id = ${ADMIN.userId} and organization_id = ${ORGANIZATION_ID}`,
      () =>
        onHome(ADMIN, async (session) => {
          const { page } = session
          const recents = homeRegion(page, 'Recents')
          const row = recents.getByRole('link', { name: SEEDED_SOURCE.title })
          await expect(row).toBeVisible()
          await row.hover()
          const removed = page.waitForResponse(
            (response) =>
              response.request().method() === 'DELETE' &&
              new URL(response.url()).pathname.endsWith('/search/history/sources')
          )
          await recents
            .getByRole('button', { name: `Remove ${SEEDED_SOURCE.title} from recents` })
            .click()
          await expect(row).toHaveCount(0)
          assert.ok((await removed).ok(), 'The server refused the removal')
          await page.reload()
          await expect(homeRegion(page, 'Email')).toBeVisible()
          await session.settle()
          await expect(recents.getByRole('link', { name: SEEDED_SOURCE.title })).toHaveCount(0)
        })
    )
  })
  await check('Recents collapse repeats, and every chip has a mark', async () => {
    const [before] =
      await sql`select sources from organization_search_history where user_id = ${ADMIN.userId} and organization_id = ${ORGANIZATION_ID}`
    const viewedAt = new Date().toISOString()
    const channel = (id: string) => ({
      url: `https://acme.slack.com/archives/C1/${id}`,
      title: '#candidates',
      connectorType: 'slack',
      viewedAt,
    })
    const sources = [
      channel('p3'),
      channel('p2'),
      { url: 'https://www.linkedin.example/in/someone', viewedAt },
      channel('p1'),
    ]
    await withRestore(
      () =>
        sql`update organization_search_history set sources = ${sql.json(before?.sources ?? [])} where user_id = ${ADMIN.userId} and organization_id = ${ORGANIZATION_ID}`,
      async () => {
        await sql`update organization_search_history set sources = ${sql.json(sources)} where user_id = ${ADMIN.userId} and organization_id = ${ORGANIZATION_ID}`
        await onHome(ADMIN, async (session) => {
          const { page } = session
          const recents = homeRegion(page, 'Recents')
          const links = recents.getByRole('link')
          await expect(links).toHaveCount(2)
          assert.deepEqual(await links.allInnerTexts(), ['#candidates', 'linkedin.example'])
          assert.equal(
            await links.first().getAttribute('href'),
            sources[0].url,
            'A collapsed chip must link its latest visit'
          )
          for (const link of await links.all()) {
            await expect(link.locator('svg, img').first()).toBeVisible()
          }
          const channelChip = links.first()
          await channelChip.hover()
          await recents.getByRole('button', { name: 'Remove #candidates from recents' }).click()
          await expect(links).toHaveCount(1)
          // The chip leaves at once and its visits are deleted one by one; a reload would abort that.
          await expect
            .poll(async () => {
              const [after] =
                await sql`select sources from organization_search_history where user_id = ${ADMIN.userId} and organization_id = ${ORGANIZATION_ID}`
              return after?.sources.map((source: { url: string }) => source.url)
            })
            .toEqual([sources[2].url])
          await page.reload()
          await expect(homeRegion(page, 'Email')).toBeVisible()
          await session.settle()
          assert.deepEqual(await recents.getByRole('link').allInnerTexts(), ['linkedin.example'])
        })
      }
    )
  })
  await check('Unread chats need attention and open under Search', async () => {
    const { id, title } = ADMIN_CHATS.assistant
    await withRestore(
      () => sql`update copilot_chats set last_seen_at = null where id = ${id}`,
      () =>
        withSession(ADMIN, async ({ page }) => {
          await sql`update copilot_chats set last_seen_at = null where id = ${id}`
          await page.goto(homeUrl)
          const row = homeRegion(page, 'Needs your attention').getByRole('link', { name: title })
          await expect(row).toHaveAttribute('href', org.searchChat(id))
          await row.click()
          await expect(page).toHaveURL((address) => address.pathname === org.searchChat(id))
        })
    )
  })
  await check('Customize Home hides a widget, and Undo brings it back', async () => {
    await onHome(ADMIN, async ({ page }) => {
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Email')).toHaveCount(0)
      await page.getByRole('button', { name: 'Undo' }).click()
      await expect(homeRegion(page, 'Email')).toBeVisible()
    })
  })
  await check('a workspace with an old run says when, and claims no status', async () => {
    await withSession(ADMIN, async ({ page }) => {
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
      await page.goto(homeUrl)
      const region = homeRegion(page, 'Workspaces')
      await expect(region.getByText('Last run failed: Invoice sync')).toBeVisible()
      await expect(region.getByText('2hrs ago')).toBeVisible()
      await expect(region.getByText('No recent workflow runs')).toBeVisible()
      const rowWidth = (await region.getByRole('link', { name: /Invoice sync/ }).boundingBox())
        ?.width
      const regionWidth = (await region.boundingBox())?.width
      assert(
        rowWidth && regionWidth && rowWidth >= regionWidth,
        `A row is ${rowWidth}px wide in a ${regionWidth}px section, too narrow to show its name`
      )
    })
  })
  await check(
    'Workspaces shows its rows while their activity is out, and keeps them if it fails',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        const release = createDeferred<void>()
        let fail = true
        await page.route(/\/home\/workspace-activity$/, async (route) => {
          await release.promise
          if (fail) await route.fulfill({ status: 500, json: { error: 'stand-in' } })
          else await route.fallback()
        })
        await page.goto(homeUrl)
        const region = homeRegion(page, 'Workspaces')
        // The names are already known, so the rows paint at once, with what they report still out.
        await expect(region.getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })).toBeVisible()
        await expect(region.getByText('…', { exact: true }).first()).toBeVisible()
        await expect(region.getByText('Up to date')).toHaveCount(0)
        release.resolve()
        await expect(
          region.getByText('What these workspaces are doing could not load.')
        ).toBeVisible({ timeout: 30_000 })
        await expect(region.getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })).toBeVisible()
        fail = false
        await region.getByRole('button', { name: 'Try again' }).click()
        await expect(
          region.getByText('What these workspaces are doing could not load.')
        ).toHaveCount(0, { timeout: 30_000 })
      })
    },
    { allow: [/500 GET .*workspace-activity/] }
  )
  await check("a builder's Home does not jump from its skeleton to its content", async () => {
    await withSession(ADMIN, async (session) => {
      const { page } = session
      await page.addInitScript(() => {
        let shift = 0
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries() as (PerformanceEntry & {
            value: number
            hadRecentInput: boolean
          })[]) {
            if (!entry.hadRecentInput) shift += entry.value
          }
        }).observe({ type: 'layout-shift', buffered: true })
        ;(window as Window & { homeLayoutShift?: () => number }).homeLayoutShift = () => shift
      })
      await page.goto(homeUrl)
      await expect(page.getByRole('main')).toBeVisible()
      await session.settle()
      const shift = await page.evaluate(() =>
        (window as Window & { homeLayoutShift?: () => number }).homeLayoutShift?.()
      )
      // 0.25 is where Core Web Vitals calls a page's shift poor.
      assert.ok((shift ?? 0) < 0.25, `Home shifted by ${shift} as it loaded`)
    })
  })
  await check("Home's sections stack without overlapping on a phone", async () => {
    await withSession(
      ADMIN,
      async (session) => {
        const { page } = session
        await page.goto(homeUrl)
        await expect(homeRegion(page, 'Workspaces')).toBeVisible()
        await session.settle()
        const seeMore = homeRegion(page, 'Workspaces').getByRole('button', { name: 'See more' })
        if ((await seeMore.count()) > 0) await seeMore.click()
        const boxes = await page
          .getByRole('main')
          .getByRole('region')
          .evaluateAll((regions) =>
            regions
              .filter((region) => region.matches('section'))
              .map((region) => {
                const { top, bottom } = region.getBoundingClientRect()
                const contentBottom = Math.max(
                  bottom,
                  ...[...region.children].map((child) => child.getBoundingClientRect().bottom)
                )
                return { name: region.getAttribute('aria-label'), top, bottom: contentBottom }
              })
              .sort((a, b) => a.top - b.top)
          )
        assert.ok(boxes.length > 1, 'Home has no sections to compare')
        for (const [index, box] of boxes.slice(1).entries()) {
          const above = boxes[index]
          assert.ok(
            above.bottom <= box.top + 1,
            `${above.name} runs ${Math.round(above.bottom - box.top)}px into ${box.name}`
          )
        }
      },
      { viewport: PHONE }
    )
  })
  await check('Home, Search and Settings each name one main region', async () => {
    await withSession(ADMIN, async ({ page }) => {
      for (const path of [org.home, org.search, org.settingsSection('general')]) {
        await page.goto(url(path))
        await expect(page.getByRole('main')).toHaveCount(1)
      }
    })
  })
  await check('Customize Home hides Workspaces across a reload, and stops its read', async () => {
    await onHome(ADMIN, async (session) => {
      const { page } = session
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
      await session.settle()
      await expect(homeRegion(page, 'Workspaces')).toHaveCount(0)
      assert.deepEqual(reads, [], 'A hidden widget still read its activity')
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Workspaces' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Workspaces')).toBeVisible()
    })
  })
  section('3 Home: admin')
  await check(
    'the chart reads its widest window once, and a range change reads nothing',
    async () => {
      await withSession(ADMIN, async (session) => {
        const { page } = session
        await page.goto(homeUrl)
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
            (Date.parse(String(query.get('endDate'))) -
              Date.parse(String(query.get('startDate')))) /
              86_400_000 +
            1
          )
        }
        // One read covers every range the menu offers, so the first one shown is already in it.
        assert.deepEqual(reads().map(days), [90], 'Home did not read its window once')
        const choose = async (from: string, to: string) => {
          await chart.getByRole('button', { name: `Range: ${from}` }).click()
          await page.getByRole('menuitemradio', { name: to }).click()
          await expect(chart.getByRole('button', { name: `Range: ${to}` })).toBeVisible()
          await expect(chart.locator('[data-plot="home-activity"]')).toBeVisible()
          await session.settle()
        }
        await choose('Last 7 days', 'Last 30 days')
        assert.deepEqual(reads().map(days), [90], 'A wider range read again')
        await choose('Last 30 days', 'Last 7 days')
        assert.deepEqual(reads().map(days), [90], 'A narrower range read again')
      })
    }
  )
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
  await check('the agent composer with its tools and the Tasks run chart', async () => {
    await onHome(ADMIN, async ({ page }) => {
      await expect(page).toHaveURL(homeUrl)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(', Ada')
      await expect(composer(page)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add attachment' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Attach file' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Skills/ }).first()).toBeVisible()
      await expect(homeRegion(page, 'Tasks run')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
    })
  })
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
      const stop = page.getByRole('button', { name: 'Stop response', exact: true })
      await expect(stop).toBeVisible()
      await stop.click()
      await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({
        timeout: 30_000,
      })
    })
  })
  await check(
    'Assistant hides the resource toggle until a resource; a builder always has it',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(assistantSearchUrl)
        await expect(composer(page)).toBeVisible()
        await expect(anyPanelToggle(page)).toHaveCount(0)
      })
      await withSession(ADMIN, async ({ page }) => {
        await stubSearch(page)
        await page.goto(url(org.chat(ADMIN_CHATS.agent.id)))
        await expect(composer(page)).toBeVisible()
        await page.goto(homeUrl)
        await expect(composer(page)).toBeVisible()
        await expect(panelToggle(page, 'Open')).toHaveCount(0)
        await page.goBack()
        await panelToggle(page, 'Open').click()
        await expect(page.getByRole('complementary', { name: 'Chat panel' })).toBeVisible()
        await panelToggle(page, 'Close').click()
        const resource = encodeURIComponent(`search:organization:${ORGANIZATION_ID}`)
        await page.goto(url(`${org.home}?q=parts&resource=${resource}`))
        await panelToggle(page, 'Close').click()
        await panelToggle(page, 'Open').click()
        await expect(panelToggle(page, 'Close')).toBeVisible()
      })
    }
  )
  await check("on a phone a builder's empty chat keeps the toggle in its own row", async () => {
    await withSession(
      ADMIN,
      async ({ page }) => {
        const anyToggle = anyPanelToggle(page)
        await page.goto(url(org.chat(ADMIN_CHATS.agent.id)))
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
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(assistantSearchUrl)
        await expect(composer(page)).toBeVisible()
        await expect(anyPanelToggle(page)).toHaveCount(0)
      },
      { viewport: PHONE }
    )
  })
  await check('a /skill or @mention sent before its list lands waits for the list', async () => {
    await withSession(ADMIN, async ({ page }) => {
      const skillsHeld = createDeferred<void>()
      // The product reads every skill in one organization-wide mentions read.
      await page.route(
        /\/api\/organizations\/[^/]+\/mentions\?(?=.*family=skills)/,
        async (route) => {
          await skillsHeld.promise
          await route.continue()
        }
      )
      const sends = captureRequests(
        page,
        (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
      )
      await page.goto(homeUrl)
      await composer(page).fill('/review this')
      await composer(page).press('Enter')
      // The composer frame carries these states itself, which a `has` filter (searched only inside
      // each candidate) cannot see, so the selectors name the frame or an ancestor of it.
      await expect(
        page.locator(
          '[aria-busy="true"]:has([data-elevation="composer"] textarea), [data-elevation="composer"][aria-busy="true"]:has(textarea)'
        )
      ).toHaveCount(1)
      await expect(composer(page)).toBeEditable()
      await expect(
        page.locator('[inert]:has([data-elevation="composer"]), [data-elevation="composer"][inert]')
      ).toHaveCount(0)
      await pageTurn(page)
      assert.deepEqual(sends, [], 'The message waits for the skill lists')
      skillsHeld.resolve()
      await expect.poll(() => sends.length, { timeout: 30_000 }).toBeGreaterThan(0)
    })
    await withSession(ADMIN, async ({ page }) => {
      const listsHeld = createDeferred<void>()
      await page.route(/\/api\/organizations\/[^/]+\/mentions/, async (route) => {
        await listsHeld.promise
        await route.continue()
      })
      await page.goto(homeUrl)
      await composer(page).click()
      await composer(page).pressSequentially('@op')
      const loading = page.getByText('Loading…', { exact: true })
      await expect(loading).toBeVisible()
      const field = composerField(page)
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
  // Legacy Home was a new chat with a resource panel; that panel lives on the new chat now.
  await check('the handoff search params restore a results tab in a new chat', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await stubSearch(page)
      const resource = `search:organization:${ORGANIZATION_ID}`
      await page.goto(url(`${org.home}?${new URLSearchParams({ q: 'parts', resource })}`))
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === org.newChat &&
          address.searchParams.get('q') === 'parts' &&
          address.searchParams.get('resource') === resource
      )
      await expect(composer(page)).toBeVisible()
      await expect(
        page
          .getByRole('complementary', { name: 'Chat panel' })
          .getByText('Service bulletin', { exact: true })
          .first()
      ).toBeVisible()
    })
  })
  notProvable('Plan chip', 'Only for platform superusers, which needs a platform admin fixture')
  notProvable('Mic with permission help', 'Headless Chromium exposes no speech recognition to test')
}
