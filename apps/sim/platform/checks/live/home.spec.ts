import { expect, type Page, test } from '@playwright/test'
import {
  memberEmail,
  organizationId,
  requireEnv,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'

test.describe('Home on real data', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page, '/org/home')
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

  test('a member who cannot read the activity summary gets no chart rather than an empty one', async ({
    page,
  }) => {
    const summary = await page.request.get(
      `/api/organizations/${organizationId()}/usage/activity/summary?preset=7d&timezone=UTC`
    )
    const chart = page.getByRole('region', { name: 'Tasks run', exact: true })
    if (summary.status() === 200) await expect(chart).toBeVisible()
    else await expect(chart).toHaveCount(0)
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

test('a member who cannot build lands on Search, not an error', async ({ page }) => {
  await signIn(page, memberEmail(), '/org/home')
  await expect(page).toHaveURL(/\/org\/search/)
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible()
})

test.describe('Home for the seeded administrator', () => {
  test('greets the member by first name', async ({ page }) => {
    await signInAsAdmin(page, '/org/home')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/, Ada$/)
  })

  test('Recents list the viewer’s real history and × removes it for good', async ({ page }) => {
    await signInAsAdmin(page, '/org/home')
    const recents = page.getByRole('region', { name: 'Recents', exact: true })
    await expect(recents.getByRole('link', { name: 'Onboarding guide' })).toBeVisible()
    const renewal = recents.getByRole('link', { name: 'Renewal terms' })
    await renewal.hover()
    await recents.getByRole('button', { name: 'Remove Renewal terms from recents' }).click()
    await expect(renewal).toHaveCount(0)
    await page.reload()
    await expect(recents.getByRole('link', { name: 'Onboarding guide' })).toBeVisible()
    await expect(renewal).toHaveCount(0)
  })

  test('an unread chat needs attention and opens from there', async ({ page }) => {
    await signInAsAdmin(page, '/org/home')
    const attention = page.getByRole('region', { name: 'Needs your attention', exact: true })
    await expect(attention.getByText('Vendor renewals')).toBeVisible()
    await expect(attention.getByText('Quarterly review')).toHaveCount(0)
    await attention.getByText('Vendor renewals').click()
    await expect(page).toHaveURL(/\/org\/search\/chat\/22222222-/)
    await expect(page.getByText('Here is what I found about Vendor renewals.')).toBeVisible()
  })

  test('Search mode drops the activity chart and offers Search’s Get started', async ({ page }) => {
    await signInAsAdmin(page, '/org/home')
    await expect(page.getByRole('region', { name: 'Tasks run', exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Search' }).click()
    await expect(page.getByRole('region', { name: 'Tasks run', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Searches', exact: true })).toHaveCount(0)
  })

  test('connecting Gmail starts the provider’s real authorization', async ({ page, context }) => {
    await context.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
    )
    await signInAsAdmin(page, '/org/home')
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
  const GRANT = 'platform-live-grant-gmail'
  const CALENDAR_GRANT = 'platform-live-grant-google-calendar'

  function account(credentialId: string, state: string) {
    return {
      credentialId,
      displayName: requireEnv('PLATFORM_LIVE_CONNECTED_EMAIL'),
      state,
    }
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

  const open = (page: Page) =>
    signIn(page, requireEnv('PLATFORM_LIVE_CONNECTED_EMAIL'), '/org/home')

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
    await email.getByRole('button', { name: 'Try again' }).click()
    await expect(email.getByText('Grace Hopper')).toBeVisible()
  })

  test('an account Google stopped honoring asks to reconnect, here and in attention', async ({
    page,
  }) => {
    await serveWidgets(page, { json: { accounts: [account(GRANT, 'needs_reauth')], threads: [] } })
    await open(page)
    await expect(
      page
        .getByRole('region', { name: 'Email', exact: true })
        .getByText('Reconnect your email', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Needs your attention', exact: true }).getByText(/Reconnect/)
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

  test('disconnecting removes the account for real and returns to the connect prompt', async ({
    page,
  }) => {
    await serveWidgets(page)
    await open(page)
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
