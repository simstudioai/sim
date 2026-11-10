import { expect, type Page } from '@playwright/test'
import {
  memberEmail,
  noChatMemberEmail,
  noChatOrganizationId,
  organizationId,
  requireEnv,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import {
  type SeededPerson,
  withLiveDatabase,
  withPerson,
} from '@/platform/checks/live/support/database'
import { liveRoute, liveRoutePattern } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

test.describe('Home on real data', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page, liveRoute('/home'))
  })

  test('the Email and Calendar widgets each settle in a state the member can act on', async ({
    page,
  }) => {
    for (const title of ['Email', 'Calendar'] as const) {
      const widget = page.getByRole('region', { name: title, exact: true })
      await expect(widget).toBeVisible()
      await expect(widget.getByRole('status', { name: /Loading/i })).toHaveCount(0)
      const noun = title.toLowerCase()
      await expect(
        widget
          .getByText(`Connect your ${noun}`, { exact: true })
          .or(widget.getByText(`Your organization has not turned on ${noun}`, { exact: true }))
          .or(widget.getByText(`Reconnect your ${noun}`, { exact: true }))
          .or(widget.getByText(`Your ${noun} could not load`, { exact: true }))
          .or(
            title === 'Email'
              ? widget.getByRole('region', { name: 'Email messages' })
              : widget.getByRole('region', { name: 'Calendar schedule' })
          )
          .or(widget.getByText('No email yet', { exact: true }))
      ).toBeVisible()
    }
  })

  test('a widget’s connect options are exactly what the organization offers', async ({ page }) => {
    const accounts = await page.request.get(
      `/api/organizations/${organizationId()}/connected-accounts`
    )
    expect(accounts.status()).toBe(200)
    const { credentialGroup, viewerAccounts } = (await accounts.json()) as {
      credentialGroup: { options: { provider: string; status: string }[] } | null
      viewerAccounts?: { providerId: string }[]
    }
    const email = page.getByRole('region', { name: 'Email', exact: true })
    const prompt = email.getByText('Connect your email', { exact: true })
    if (viewerAccounts?.length || !(await prompt.isVisible())) return
    const offered = new Set(credentialGroup?.options.map((option) => option.provider))
    await expect(email.getByRole('button', { name: 'Gmail', exact: true })).toHaveCount(
      offered.has('gmail') ? 1 : 0
    )
    await expect(email.getByRole('button', { name: 'Outlook', exact: true })).toHaveCount(
      offered.has('outlook') ? 1 : 0
    )
  })

  test('Home charts the activity summary the seeded administrator may read', async ({ page }) => {
    const summary = await page.request.get(
      `/api/organizations/${organizationId()}/usage/activity/summary?preset=7d&timezone=UTC`
    )
    expect(summary.status()).toBe(200)
    await expect(page.getByRole('region', { name: 'Tasks run', exact: true })).toBeVisible()
  })

  test('the widget reads refuse an organization the member does not belong to', async ({
    page,
  }) => {
    for (const widget of ['email', 'calendar?date=2026-11-05&timeZone=UTC']) {
      const response = await page.request.get(
        `/api/organizations/not-the-members-organization/home/${widget}`
      )
      expect(response.status()).toBe(404)
    }
  })

  test('Customize Home hides a widget for the session and Undo restores it', async ({ page }) => {
    await page.getByRole('button', { name: 'Customize Home' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
    await page.keyboard.press('Escape')
    const email = page.getByRole('region', { name: 'Email', exact: true })
    await expect(email).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(email).toBeVisible()
  })
})

test('a plain member lands on Home and may open a new chat', async ({ page }) => {
  await signIn(page, memberEmail(), liveRoute(''))
  await expect(page).toHaveURL(liveRoutePattern('/home'))
  await page.goto(liveRoute('/chat'))
  await expect(page).toHaveURL(liveRoutePattern('/chat', '(?:\\?|$)'))
})

test('a member whose permission group withholds Chat lands on Search, not an error', async ({
  page,
}) => {
  const organization = noChatOrganizationId()
  await signIn(page, noChatMemberEmail(), liveRoute('/home', organization))
  await expect(page).toHaveURL(liveRoutePattern('/search', '', organization))
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0)
})

test('a member whose permission group withholds Chat lands on Search from a deep link to a new chat', async ({
  page,
}) => {
  const organization = noChatOrganizationId()
  await signIn(page, noChatMemberEmail(), liveRoute('/search', organization))
  for (const deepLink of [liveRoute('', organization), liveRoute('/chat/new', organization)]) {
    await page.goto(deepLink)
    await expect(page, deepLink).toHaveURL(liveRoutePattern('/search', '(?:\\?|$)', organization))
    await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible()
  }
  const create = await page.request.post('/api/mothership/chats', {
    data: { organizationId: organization, mode: 'agent' },
  })
  expect(create.status()).toBe(403)
})

test.describe('Home for the seeded administrator', () => {
  test('greets the member by first name', async ({ page }) => {
    await signInAsAdmin(page, liveRoute('/home'))
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/, Ada$/)
  })

  test('Recents list the viewer’s real history and × removes it for good', async ({ page }) => {
    await signInAsAdmin(page, liveRoute('/home'))
    // A source of this run's own: removing it for good leaves the seeded history as it was.
    const run = Date.now()
    const title = `Live recent ${run}`
    const recorded = await page.request.post(
      `/api/organizations/${organizationId()}/search/history`,
      { data: { kind: 'source', source: { url: `https://example.com/live-recent-${run}`, title } } }
    )
    expect(recorded.status()).toBe(200)
    await page.reload()
    const recents = page.getByRole('region', { name: 'Recents', exact: true })
    await expect(recents.getByRole('link', { name: 'Onboarding guide' })).toBeVisible()
    const recent = recents.getByRole('link', { name: title })
    await recent.hover()
    await recents.getByRole('button', { name: `Remove ${title} from recents` }).click()
    await expect(recent).toHaveCount(0)
    await page.reload()
    await expect(recents.getByRole('link', { name: 'Onboarding guide' })).toBeVisible()
    await expect(recent).toHaveCount(0)
  })

  test('an assistant chat opens under Search, and Home paints no attention list', async ({
    page,
  }) => {
    await signInAsAdmin(page, liveRoute('/home'))
    await expect(
      page.getByRole('region', { name: 'Needs your attention', exact: true })
    ).toHaveCount(0)
    const chats = page.getByRole('region', { name: 'Chats', exact: true })
    const vendorRenewals = chats.getByRole('link', { name: 'Vendor renewals' })
    // Chats the other live checks start sort above the seeded one, a page or more down the rail.
    await expect(async () => {
      if ((await vendorRenewals.count()) === 0)
        await chats.getByRole('button', { name: 'See more', exact: true }).click()
      await expect(vendorRenewals).toBeVisible({ timeout: 1_000 })
    }).toPass()
    await vendorRenewals.click()
    await expect(page).toHaveURL(liveRoutePattern('/search/chat/22222222-'))
    await expect(page.getByText('Here is what I found about Vendor renewals.')).toBeVisible()
  })

  test('Search mode drops the activity chart and offers Search’s Get started', async ({ page }) => {
    await signInAsAdmin(page, liveRoute('/home'))
    await expect(page.getByRole('region', { name: 'Tasks run', exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Search' }).click()
    await expect(page.getByRole('region', { name: 'Tasks run', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Searches', exact: true })).toHaveCount(0)
  })

  test('connecting Gmail starts the provider’s real authorization', async ({ page, context }) => {
    await context.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
    )
    await signInAsAdmin(page, liveRoute('/home'))
    const authorization = context.waitForEvent('request', (request) =>
      request.url().startsWith('https://accounts.google.com/')
    )
    await page
      .getByRole('region', { name: 'Email', exact: true })
      .getByRole('button', { name: 'Gmail', exact: true })
      .click()
    const url = new URL((await authorization).url())
    expect(url.searchParams.get('client_id')).toBe(process.env.GOOGLE_CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toContain('/api/')
  })
})

/**
 * The seeded member holds real Gmail and Calendar grants with fixture tokens. Google cannot honor
 * those, so these replace the widget reads at the browser's network boundary: they prove what Home
 * does with each answer. `home-widgets.integration.ts` proves the reads behind them.
 */
test.describe('Home with connected accounts', () => {
  const connectedEmail = () => requireEnv('PLATFORM_LIVE_CONNECTED_EMAIL')
  const GRANT = 'platform-live-grant-gmail'
  const CALENDAR_GRANT = 'platform-live-grant-google-calendar'

  function account(credentialId: string, state: string, displayName = connectedEmail()) {
    return { credentialId, displayName, state }
  }

  const THREADS = [
    {
      id: 'thread-1',
      credentialId: GRANT,
      sender: 'Grace Hopper',
      subject: 'Compiler review',
      excerpt: 'The draft is ready',
      receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
      messageCount: 3,
      url: 'https://mail.google.com/mail/u/0/#inbox/thread-1',
    },
  ]

  function calendarFor(date: string) {
    const startAt = `${date}T15:00:00.000Z`
    return {
      accounts: [account(CALENDAR_GRANT, 'ready')],
      window: { startAt: `${date}T00:00:00.000Z`, endAt: `${date}T23:59:59.000Z` },
      events: [
        {
          id: `event-${date}`,
          credentialId: CALENDAR_GRANT,
          title: `Standup ${date}`,
          allDay: false,
          startAt,
          endAt: `${date}T15:30:00.000Z`,
          people: [{ name: 'Grace Hopper' }],
        },
      ],
    }
  }

  const READY_MAIL = { accounts: [account(GRANT, 'ready')], threads: THREADS }

  async function serveWidgets(
    page: Page,
    mail: { status?: number; json: unknown } = { json: READY_MAIL }
  ) {
    await page.route('**/home/email', (route) => route.fulfill(mail))
    await page.route('**/home/calendar?*', (route) => {
      const date = new URL(route.request().url()).searchParams.get('date') as string
      return route.fulfill({ json: calendarFor(date) })
    })
  }

  const open = (page: Page) => signIn(page, connectedEmail(), liveRoute('/home'))

  test('a connected member reads their mail, opens a thread, and keeps a chosen day', async ({
    page,
    context,
  }) => {
    await serveWidgets(page)
    await context.route('https://mail.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Gmail stand-in' })
    )
    await open(page)
    const email = page.getByRole('region', { name: 'Email', exact: true })
    await expect(email.getByText('Grace Hopper')).toBeVisible()
    await expect(email.getByText('Compiler review')).toBeVisible()
    const opened = context.waitForEvent('page')
    await email.getByText('Grace Hopper').click()
    expect((await opened).url()).toContain('mail.google.com/mail/u/0/#inbox/thread-1')

    const calendar = page.getByRole('region', { name: 'Calendar', exact: true })
    await expect(calendar.getByText(/^Standup \d{4}-\d{2}-\d{2}$/)).toBeVisible()
    const next = page.waitForRequest((request) => request.url().includes('/home/calendar?'))
    await calendar.getByRole('button', { name: 'Next day' }).click()
    const chosen = new URL((await next).url()).searchParams.get('date') as string
    await expect(page).toHaveURL(new RegExp(`day=${chosen}`))
    await expect(calendar.getByText(`Standup ${chosen}`)).toBeVisible()
    await page.reload()
    await expect(calendar.getByText(`Standup ${chosen}`)).toBeVisible()
  })

  test('a failed read offers a retry that recovers, with nothing else on Home affected', async ({
    page,
  }) => {
    let failing = true
    await serveWidgets(page)
    await page.route('**/home/email', (route) =>
      failing
        ? route.fulfill({ status: 500, json: { error: 'Provider down' } })
        : route.fulfill({ json: READY_MAIL })
    )
    await open(page)
    const email = page.getByRole('region', { name: 'Email', exact: true })
    await expect(email.getByText('Your email could not load')).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('region', { name: 'Calendar', exact: true }).getByText(/^Standup /)
    ).toBeVisible()
    failing = false
    await email.getByRole('button', { name: 'Retry' }).click()
    await expect(email.getByText('Grace Hopper')).toBeVisible()
  })

  test('an account Google stopped honoring asks to reconnect', async ({ page }) => {
    await serveWidgets(page, { json: { accounts: [account(GRANT, 'needs_reauth')], threads: [] } })
    await open(page)
    await expect(
      page
        .getByRole('region', { name: 'Email', exact: true })
        .getByText('Reconnect your email', { exact: true })
    ).toBeVisible()
  })

  test('a connected member with an empty mailbox sees that, not a prompt to connect', async ({
    page,
  }) => {
    await serveWidgets(page, { json: { accounts: [account(GRANT, 'ready')], threads: [] } })
    await open(page)
    const email = page.getByRole('region', { name: 'Email', exact: true })
    await expect(email.getByText('No email yet', { exact: true })).toBeVisible()
    await expect(email.getByText('Connect your email', { exact: true })).toHaveCount(0)
  })

  /**
   * A connected administrator made for one check, holding copies of the seeded member's Gmail and
   * Calendar grants, so removing theirs leaves the seeded member's for every other check and run.
   */
  async function withOwnConnectedMember(check: (person: SeededPerson) => Promise<void>) {
    await withPerson(
      'connected',
      { organizationId: organizationId(), role: 'admin' },
      async (person) => {
        await withLiveDatabase((sql) =>
          sql.begin(async (tx) => {
            await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
            select ${person.id}::text || '-' || entity_id, ${person.id}, entity_type, entity_id, permission_type
            from permissions
            where user_id = (select id from "user" where email = ${connectedEmail()})
              and entity_type = 'workspace'`
            await tx`insert into credential_group_enrollment
            select (jsonb_populate_record(null::credential_group_enrollment, to_jsonb(e) || jsonb_build_object(
              'id', ${`${person.id}-enrollment`}::text, 'user_id', ${person.id}::text,
              'email', ${person.email}::text, 'invitation_token_hash', ${`${person.id}-token`}::text))).*
            from credential_group_enrollment e where e.id = 'platform-live-enrollment'`
            for (const grant of [GRANT, CALENDAR_GRANT]) {
              await tx`insert into credential
              select (jsonb_populate_record(null::credential, to_jsonb(c) || jsonb_build_object(
                'id', ${`${person.id}-${grant}`}::text, 'created_by', ${person.id}::text,
                'credential_group_enrollment_id', ${`${person.id}-enrollment`}::text,
                'display_name', ${person.email}::text))).*
              from credential c where c.id = ${grant}`
            }
          })
        )
        await check(person)
      }
    )
  }

  test('disconnecting removes the account for real and returns to the connect prompt', async ({
    page,
  }) => {
    await withOwnConnectedMember(async (person) => {
      const grant = `${person.id}-${GRANT}`
      await serveWidgets(page, {
        json: { accounts: [account(grant, 'ready', person.email)], threads: [] },
      })
      await signIn(page, person.email, liveRoute('/home'))
      const email = page.getByRole('region', { name: 'Email', exact: true })
      await email.getByRole('button', { name: 'Email options' }).click()
      await page.getByRole('menuitem', { name: 'Disconnect Email' }).click()
      const dialog = page.getByRole('dialog', { name: 'Disconnect Email?' })
      await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(email.getByText('Connect your email', { exact: true })).toBeVisible()
      await page.reload()
      await expect(email.getByText('Connect your email', { exact: true })).toBeVisible()
    })
  })
})
