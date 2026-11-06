import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'

/**
 * Exercises the People page's API over real HTTP against a running local app (with
 * `PEOPLE=true`) and a disposable local PostgreSQL database. SQL seeds organizations and their
 * members. Set PEOPLE_E2E_SCREENSHOT_DIR to exercise the signed-in browser and save its views.
 * Every import, edit, and read crosses the real app boundary, and membership changes
 * are made in SQL to prove the database keeps profiles and reporting lines consistent.
 */
const logger = createLogger('PeopleE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('PEOPLE_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(requiredEnvironment('PEOPLE_E2E_DATABASE_URL'))
const authSecret = requiredEnvironment('PEOPLE_E2E_AUTH_SECRET')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')
assert(!baseUrl.username && !baseUrl.password, 'App URL must not contain credentials')
assert(authSecret.length >= 32, 'Use a local auth secret of at least 32 characters')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const organizationIds: string[] = []
const userIds: string[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const startedAt = new Date().toISOString()
let requestCount = 0

interface Member {
  userId: string
  memberId: string
  orgId: string
  email: string
  cookie: string
}

async function api(
  member: Member,
  path: string,
  { method = 'GET', body, expected = 200 }: { method?: string; body?: unknown; expected?: number }
): Promise<Record<string, unknown>> {
  const headers = new Headers({ 'User-Agent': 'Sim-local-people-E2E', Origin: baseUrl.origin })
  headers.set('Cookie', `better-auth.session_token=${member.cookie}`)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(
    new URL(`/api/organizations/${member.orgId}/people${path}`, baseUrl),
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    }
  )
  requestCount++
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${text}`)
  const parsed: unknown = text ? JSON.parse(text) : {}
  assert(isRecordLike(parsed), 'Expected a JSON object')
  return parsed
}

function importRows(member: Member, csv: string, apply: boolean, expected = 200) {
  const [headerLine, ...lines] = csv.trim().split('\n')
  const headers = headerLine.split(',')
  const rows = lines.map((line) => line.split(','))
  return api(member, '/import', { method: 'POST', body: { headers, rows, apply }, expected })
}

async function person(member: Member, memberId: string) {
  const result = await api(member, `/${memberId}`, {})
  assert(isRecordLike(result.person), 'Expected a person')
  return result as {
    person: Record<string, unknown> & {
      manager: { memberId: string } | null
      managerMemberId: string | null
    }
    chain: { memberId: string }[]
    reports: { memberId: string }[]
  }
}

async function profileRow(memberId: string) {
  const [row] = await sql<
    { title: string | null; department: string | null; manager_member_id: string | null }[]
  >`select title, department, manager_member_id from member_profile where member_id = ${memberId}`
  return row ?? null
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    throw error
  }
}

async function seedOrganization(): Promise<string> {
  const orgId = generateId()
  organizationIds.push(orgId)
  await sql`insert into organization (id, name, slug, created_at)
    values (${orgId}, 'People E2E', ${`people-e2e-${generateShortId().toLowerCase()}`}, now())`
  return orgId
}

async function seedMember(
  orgId: string,
  role: 'owner' | 'admin' | 'member',
  label: string
): Promise<Member> {
  const userId = generateId()
  const memberId = generateId()
  userIds.push(userId)
  const email = `${label.toLowerCase().replaceAll(' ', '-')}-${userId.slice(0, 8)}@people-e2e.test`
  const token = generateShortId()
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, ${label}, ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${memberId}, ${userId}, ${orgId}, ${role})`
    await tx`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${token}, ${userId}, ${orgId}, now() + interval '1 day', now(), now())`
  })
  return {
    userId,
    memberId,
    orgId,
    email,
    cookie: encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`),
  }
}

async function seedBrowserWorkspace(viewer: Member) {
  const id = generateId()
  await sql.begin(async (tx) => {
    await tx`insert into project (id, name, owner_id, organization_id)
      values (${id}, 'People test project', ${viewer.userId}, ${viewer.orgId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id, organization_id)
      values (${id}, ${id}, 'People test workspace', ${viewer.userId}, ${viewer.userId}, ${viewer.orgId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${viewer.userId}, 'workspace', ${id}, 'admin')`
  })
}

async function run() {
  const orgId = await seedOrganization()
  const owner = await seedMember(orgId, 'owner', 'Grace')
  const ada = await seedMember(orgId, 'member', 'Ada')
  const linus = await seedMember(orgId, 'member', 'Linus')
  const outsider = await seedMember(await seedOrganization(), 'owner', 'Outsider')

  await check('members see everyone in their organization, and no one else does', async () => {
    const { people } = await api(ada, '', {})
    assert(Array.isArray(people) && people.length === 3, `Expected 3 people, got ${people}`)
    assert.deepEqual((await api(ada, '/departments', {})).departments, [])
    await api({ ...outsider, orgId }, '', { expected: 404 })
    await api({ ...outsider, orgId }, `/${ada.memberId}`, { expected: 404 })
    await api(outsider, `/${ada.memberId}`, { expected: 404 })
  })

  await check('only administrators import or edit people data', async () => {
    await importRows(ada, `email,title\n${ada.email},Engineer`, false, 403)
    await api(ada, `/${ada.memberId}`, {
      method: 'PUT',
      body: {
        title: 'x',
        department: null,
        location: null,
        startDate: null,
        managerMemberId: null,
      },
      expected: 403,
    })
  })

  await check(
    'sync settings and credentials are restricted to this organization’s admins',
    async () => {
      const credentials = { source: 'okta', domain: 'untrusted.invalid', token: 'test-only-token' }
      for (const [subject, denial] of [
        [ada, 403],
        [{ ...outsider, orgId }, 404],
      ] as const) {
        await api(subject, '/sync', { expected: denial })
        await api(subject, '/sync', { method: 'PUT', body: credentials, expected: denial })
        await api(subject, '/sync/run', { method: 'POST', expected: denial })
        await api(subject, '/sync', { method: 'DELETE', expected: denial })
      }
      await api(owner, '/sync', { method: 'PUT', body: credentials, expected: 400 })
      assert.equal((await api(owner, '/sync', {})).sync, null)
    }
  )

  await check('chart focus is scoped to the viewer and the routed organization', async () => {
    const branch = await api(ada, '/chart', {})
    assert(isRecordLike(branch.person))
    assert.equal(branch.person.memberId, ada.memberId)
    await api(ada, `/chart?memberId=${outsider.memberId}`, { expected: 404 })
    await api({ ...outsider, orgId }, '/chart', { expected: 404 })
    await api(ada, '/import', {
      method: 'POST',
      body: { source: 'directory', apply: false },
      expected: 403,
    })
  })

  await check(
    'direct provider reads require administrator access and refuse external Okta hosts',
    async () => {
      const body = {
        source: 'okta',
        domain: 'outside.invalid',
        token: 'fixture-token',
        apply: false,
      }
      await api(ada, '/import', { method: 'POST', body, expected: 403 })
      await api(owner, '/import', { method: 'POST', body, expected: 400 })
      await api(ada, '/import', {
        method: 'POST',
        body: { source: 'entra', token: 'fixture-token', apply: false },
        expected: 403,
      })
    }
  )

  const csv = [
    'Work Email,Job Title,Dept,City,Country,Hire Date,Manager Email',
    `${ada.email.toUpperCase()},Engineer,Platform,Berlin,Germany,3/4/2021,${owner.email}`,
    `${linus.email},Kernel Lead,Platform,,Finland,2019-07-01,${ada.email}`,
    `${owner.email},CEO,Leadership,Austin,United States,2018-01-15,`,
    `stranger@people-e2e.test,Ghost,Nowhere,,,,`,
    `${ada.email},Duplicate,Platform,,,,`,
    `${outsider.email},Spy,Leadership,,,,`,
    `not-an-email,X,Y,,,,`,
    `${linus.email.toUpperCase()},Again,,,,,`,
  ].join('\n')

  await check('a preview reports every change and issue and writes nothing', async () => {
    const preview = await importRows(owner, csv, false)
    assert.equal(preview.applied, false)
    assert.equal(preview.updated, 3)
    assert.equal(preview.skipped, 5)
    assert.equal(preview.warnings, 0)
    assert.deepEqual(
      (preview.issues as { row: number; message: string }[]).map((issue) => [
        issue.row,
        issue.message,
      ]),
      [
        [5, 'Not a member of this organization'],
        [6, 'Already listed in row 2'],
        [7, 'Not a member of this organization'],
        [8, 'Enter a valid email address'],
        [9, 'Already listed in row 3'],
      ]
    )
    assert.equal(await profileRow(ada.memberId), null)
  })

  await check(
    'applying writes profiles, resolves managers by email, and is idempotent',
    async () => {
      const applied = await importRows(owner, csv, true)
      assert.equal(applied.updated, 3)
      const adaProfile = await person(owner, ada.memberId)
      assert.equal(adaProfile.person.title, 'Engineer')
      assert.equal(adaProfile.person.location, 'Berlin, Germany')
      assert.equal(adaProfile.person.startDate, '2021-03-04')
      assert.equal(adaProfile.person.manager?.memberId, owner.memberId)
      assert.equal(await profileRow(outsider.memberId), null)
      const again = await importRows(owner, csv, true)
      assert.equal(again.updated, 0)
      assert.equal(again.unchanged, 3)
    }
  )

  await check(
    'a focused branch exposes report counts and the nearest-first manager path',
    async () => {
      const branch = await api(ada, `/chart?memberId=${owner.memberId}&page=500`, {})
      assert.equal(branch.totalReports, 1)
      assert.equal(branch.page, 1)
      const [report] = branch.reports as { memberId: string; reportCount: number }[]
      assert.equal(report.memberId, ada.memberId)
      assert.equal(report.reportCount, 1)
      const leaf = await api(linus, '/chart', {})
      assert.deepEqual(
        (leaf.chain as { memberId: string }[]).map((r) => r.memberId),
        [ada.memberId, owner.memberId]
      )
      assert.deepEqual(leaf.reports, [])
    }
  )

  await check('profiles show the reporting chain above and the reports below', async () => {
    const linusProfile = await person(ada, linus.memberId)
    assert.deepEqual(
      linusProfile.chain.map((entry) => entry.memberId),
      [ada.memberId, owner.memberId]
    )
    const ownerProfile = await person(ada, owner.memberId)
    assert.deepEqual(
      ownerProfile.reports.map((entry) => entry.memberId),
      [ada.memberId]
    )
  })

  await check('search and department filters narrow the list', async () => {
    const { departments } = await api(ada, '/departments', {})
    assert.deepEqual(departments, [
      { name: 'Platform', count: 2 },
      { name: 'Leadership', count: 1 },
    ])
    const platform = await api(ada, '?department=Platform', {})
    assert.equal((platform.people as unknown[]).length, 2)
    const kernel = await api(ada, '?search=kernel', {})
    assert.equal((kernel.people as unknown[]).length, 1)
    await api(ada, '?cursor=not-a-cursor', { expected: 400 })
  })

  await check('reporting loops and foreign managers are refused', async () => {
    const body = { title: 'CEO', department: 'Leadership', location: null, startDate: null }
    for (const [managerMemberId, message] of [
      [linus.memberId, 'That manager reports to this person'],
      [owner.memberId, "A person can't be their own manager"],
      [outsider.memberId, 'The manager must be a member of this organization'],
    ]) {
      const refused = await api(owner, `/${owner.memberId}`, {
        method: 'PUT',
        body: { ...body, managerMemberId },
        expected: 400,
      })
      assert.equal(refused.error, message)
    }
    const loop = await importRows(owner, `email,manager_email\n${owner.email},${linus.email}`, true)
    assert.equal(loop.updated, 0)
    assert.equal(loop.warnings, 1)
    assert.equal((await profileRow(owner.memberId))?.manager_member_id, null)
  })

  await check('an edit replaces the profile and blank values clear it', async () => {
    await api(owner, `/${linus.memberId}`, {
      method: 'PUT',
      body: {
        title: '  Principal Engineer ',
        department: '',
        location: null,
        startDate: '2019-07-01',
        managerMemberId: owner.memberId,
      },
    })
    const row = await profileRow(linus.memberId)
    assert.equal(row?.title, 'Principal Engineer')
    assert.equal(row?.department, null)
    assert.equal(row?.manager_member_id, owner.memberId)
  })

  await check(
    "an edit keeps a suspended manager it doesn't change, and refuses one as a new manager",
    async () => {
      const margaret = await seedMember(orgId, 'member', 'Margaret')
      const edit = (memberId: string, body: Record<string, unknown>, expected = 200) =>
        api(owner, `/${memberId}`, { method: 'PUT', body, expected })
      await edit(ada.memberId, {
        title: 'Engineer',
        department: 'Platform',
        location: 'Berlin, Germany',
        startDate: '2021-03-04',
        managerMemberId: margaret.memberId,
      })
      await sql`update "user" set suspended_at = now() where id = ${margaret.userId}`

      const { person: shown } = await person(owner, ada.memberId)
      assert.equal(shown.manager, null, 'A suspended manager is not shown')
      assert.equal(shown.managerMemberId, margaret.memberId, 'The stored link is still reported')
      const saved = await edit(ada.memberId, {
        title: 'Staff Engineer',
        department: shown.department,
        location: shown.location,
        startDate: shown.startDate,
        managerMemberId: shown.managerMemberId,
      })
      assert(isRecordLike(saved.person), 'Expected a person')
      assert.equal(saved.person.managerMemberId, margaret.memberId)
      const row = await profileRow(ada.memberId)
      assert.equal(row?.title, 'Staff Engineer')
      assert.equal(row?.manager_member_id, margaret.memberId)

      const refused = await edit(
        linus.memberId,
        {
          title: 'Principal Engineer',
          department: null,
          location: null,
          startDate: '2019-07-01',
          managerMemberId: margaret.memberId,
        },
        400
      )
      assert.equal(refused.error, 'The manager must be a member of this organization')
      assert.equal((await profileRow(linus.memberId))?.manager_member_id, owner.memberId)

      await edit(ada.memberId, {
        title: 'Staff Engineer',
        department: shown.department,
        location: shown.location,
        startDate: shown.startDate,
        managerMemberId: owner.memberId,
      })
      assert.equal((await profileRow(ada.memberId))?.manager_member_id, owner.memberId)
    }
  )

  await check(
    'leaving the organization removes the profile and clears reporting lines',
    async () => {
      await sql`delete from member where id = ${owner.memberId}`
      assert.equal(await profileRow(owner.memberId), null)
      assert.equal((await profileRow(ada.memberId))?.manager_member_id, null)
      assert.equal((await profileRow(linus.memberId))?.manager_member_id, null)
    }
  )

  await check('imports and edits are audited', async () => {
    const expected = { 'org_people.imported': 3, 'org_member.profile_updated': 4 }
    let counts: Record<string, number> = {}
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await sql<
        { action: string; count: number }[]
      >`select action, count(*)::int as count
        from audit_log where resource_id = ${orgId} and action in ${sql(Object.keys(expected))}
        group by action`
      counts = Object.fromEntries(rows.map((row) => [row.action, row.count]))
      if (Object.entries(expected).every(([action, count]) => counts[action] === count)) break
      await sleep(250)
    }
    assert.deepEqual(counts, expected, 'Previews are not audited; each apply and edit is')
  })

  const teamOrg = await seedOrganization()
  const lead = await seedMember(teamOrg, 'owner', 'Maya Chen')
  const teammates: Member[] = []
  const longTitle = 'Staff Engineer for Infrastructure Reliability and Developer Experience'
  const roster = [
    ['Amara Cole', longTitle],
    ['Ben Ortega', 'Design Lead'],
    ['Elena Park', 'Product Manager'],
    ['Felix Ward', 'Platform Lead'],
    ['Lena Ali', 'Research Lead'],
    ['Robin Bell', 'Director of Product'],
  ]
  for (const [name] of roster) teammates.push(await seedMember(teamOrg, 'member', name))
  const report = await seedMember(teamOrg, 'member', 'June Evans')
  await importRows(
    lead,
    [
      'email,title,department,manager_email',
      `${lead.email},VP Engineering,Engineering,`,
      ...teammates.map(
        (person, index) => `${person.email},${roster[index][1]},Engineering,${lead.email}`
      ),
      `${report.email},Engineer,Engineering,${teammates[0].email}`,
    ].join('\n'),
    true
  )

  await check(
    'provider exports prefer mail and fall back to a blank row’s sign-in address',
    async () => {
      const preview = await importRows(
        lead,
        [
          'mail,userPrincipalName,jobTitle',
          `${teammates[0].email},${teammates[1].email},Architect`,
          `,${teammates[1].email},Product Designer`,
        ].join('\n'),
        false
      )
      assert.equal(preview.updated, 2)
      assert.equal(preview.skipped, 0)
    }
  )

  await check('large teams page in name order and shrink after offboarding', async () => {
    const read = (page: number) => api(lead, `/chart?page=${page}`, {})
    const second = await read(2)
    assert.equal(second.totalReports, 6)
    assert.deepEqual(
      (second.reports as { memberId: string }[]).map((r) => r.memberId),
      teammates.slice(4).map((p) => p.memberId)
    )
    await sql`update "user" set suspended_at = now() where id = ${teammates[5].userId}`
    const last = await read(99)
    assert.equal(last.page, 2)
    assert.equal(last.totalReports, 5)
    assert.deepEqual(
      (last.reports as { memberId: string }[]).map((r) => r.memberId),
      [teammates[4].memberId]
    )
  })

  const unlinked = await seedMember(teamOrg, 'member', 'Rae Dunn')
  await check(
    'top-level teams exclude individual members and include leaders whose manager is suspended',
    async () => {
      const roots = async () =>
        ((await api(lead, '?scope=roots', {})).people as { memberId: string }[]).map(
          (p) => p.memberId
        )
      assert.deepEqual(await roots(), [lead.memberId])
      await sql`update "user" set suspended_at = now() where id = ${lead.userId}`
      const visible = (await api(teammates[0], '?scope=roots', {})).people as { memberId: string }[]
      assert.deepEqual(
        visible.map((p) => p.memberId),
        [teammates[0].memberId]
      )
      await sql`update "user" set suspended_at = null where id = ${lead.userId}`
    }
  )

  const screenshotDir = process.env.PEOPLE_E2E_SCREENSHOT_DIR
  if (screenshotDir)
    await check('browse the org chart by keyboard, search, history and touch', async () => {
      const { chromium, expect: browserExpect } = await import('@playwright/test')
      const expect = browserExpect.configure({ timeout: 60_000 })
      await Promise.all([seedBrowserWorkspace(lead), seedBrowserWorkspace(outsider)])
      const browser = await chromium.launch()
      try {
        await mkdir(screenshotDir, { recursive: true })
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        page.setDefaultTimeout(60_000)
        await page
          .context()
          .addCookies([
            { name: 'better-auth.session_token', value: lead.cookie, url: baseUrl.origin },
          ])
        const path = `/o/${teamOrg}/people`
        await page.goto(new URL(path, baseUrl).href, {
          waitUntil: 'domcontentloaded',
          timeout: 180_000,
        })
        const focused = (name: string) =>
          page.getByRole('link', { name: `View profile for ${name}` })
        await expect(focused('Maya Chen')).toBeVisible({ timeout: 120_000 })
        await expect(page.getByRole('button', { name: 'Explore Felix Ward' })).toBeVisible()
        const longTitleLabel = page
          .getByRole('button', { name: 'Explore Amara Cole' })
          .getByText(longTitle, { exact: true })
        await longTitleLabel.hover()
        await expect(
          page.locator('[data-native-surface-overlay]').filter({ hasText: longTitle })
        ).toBeVisible()
        await page.mouse.move(0, 0)
        await page.screenshot({ path: join(screenshotDir, 'desktop.png') })
        const card = focused('Maya Chen')
        const cardWidth = await card.evaluate((node) => node.getBoundingClientRect().width)
        await page.getByRole('button', { name: 'Zoom in' }).click()
        await expect
          .poll(() => card.evaluate((node) => node.getBoundingClientRect().width))
          .toBeGreaterThan(cardWidth)
        await page.getByRole('button', { name: 'Fit chart' }).click()
        const lightCardColor = await card.evaluate((node) => getComputedStyle(node).backgroundColor)
        await page.emulateMedia({ colorScheme: 'dark' })
        await expect
          .poll(() => card.evaluate((node) => getComputedStyle(node).backgroundColor))
          .not.toBe(lightCardColor)
        await page.screenshot({ path: join(screenshotDir, 'desktop-dark.png') })
        await page.emulateMedia({ colorScheme: 'light' })
        await page.getByRole('button', { name: 'Next reports' }).focus()
        await page.keyboard.press('Enter')
        await page.getByRole('button', { name: 'Explore Lena Ali' }).waitFor()
        await expect(page.getByRole('button', { name: 'Previous reports' })).toBeFocused()
        await page.keyboard.press('Enter')
        const amara = page.getByRole('button', { name: 'Explore Amara Cole' })
        await amara.focus()
        await page.keyboard.press('Enter')
        await expect(focused('Amara Cole')).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Amara Cole', exact: true })).toBeFocused()
        await page.getByRole('button', { name: 'Explore June Evans' }).waitFor()
        await page.waitForURL((url) => url.searchParams.get('focus') === teammates[0].memberId)
        await page.goBack()
        await expect(focused('Maya Chen')).toBeVisible()
        const searched = new Set<string>()
        const pagedSearch = 'Directory colleague'
        const requestedPages: (string | null)[] = []
        page.on('request', (request) => {
          const url = new URL(request.url())
          const term = url.searchParams.get('search')
          if (url.pathname !== `/api/organizations/${teamOrg}/people` || !term) return
          searched.add(term)
          if (term === pagedSearch) requestedPages.push(url.searchParams.get('cursor'))
        })
        const boundedPaste = 'q'.repeat(200)
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.evaluate(
          (text) => navigator.clipboard.writeText(text),
          `${boundedPaste}${'界'.repeat(4096)}`
        )
        await page.getByLabel('Find a person').click()
        const pickerSearch = page.getByPlaceholder('Search name, title or email…')
        await pickerSearch.focus()
        await pickerSearch.press('ControlOrMeta+v')
        await expect(pickerSearch).toHaveValue(boundedPaste, { timeout: 5_000 })
        await expect.poll(() => searched.has(boundedPaste)).toBe(true)
        await sql.begin(async (tx) => {
          await tx`insert into people_directory_sync (organization_id, source, source_target, next_sync_at)
            values (${teamOrg}, 'okta', 'picker.okta.com', now() + interval '1 day')`
          await tx`insert into people_directory_entry (id, organization_id, source, external_id, email, name)
            select gen_random_uuid()::text, ${teamOrg}, 'okta', 'picker-' || n, 'picker-' || n || '@example.test',
              ${pagedSearch}::text || ' ' || lpad(n::text, 3, '0') from generate_series(1, 101) n`
        })
        try {
          await pickerSearch.fill(pagedSearch)
          await expect(page.getByRole('option', { name: /^Directory colleague 001/ })).toBeVisible()
          const more = page.getByRole('button', { name: 'Load more', exact: true })
          await expect(more).toBeVisible({ timeout: 5_000 })
          await Promise.all([
            page.waitForResponse((response) => {
              const url = new URL(response.url())
              return (
                url.pathname === `/api/organizations/${teamOrg}/people` &&
                url.searchParams.get('search') === pagedSearch &&
                url.searchParams.has('cursor') &&
                response.ok()
              )
            }),
            more.click(),
          ])
          await more.scrollIntoViewIfNeeded()
          await page.getByRole('option', { name: /^Directory colleague 100/ }).click()
          await expect(
            page.getByText('No reporting lines for Directory colleague 100', { exact: true })
          ).toBeVisible()
          assert.equal(requestedPages.length, 2, 'One click loads exactly one additional page')
          assert.equal(requestedPages[0], null)
          assert(requestedPages[1], 'Page two resumes with a cursor')
          await page.goBack()
          await expect(focused('Maya Chen')).toBeVisible()
        } finally {
          await sql`delete from people_directory_sync where organization_id = ${teamOrg} and source_target = 'picker.okta.com'`
        }
        await page.getByLabel('Find a person').click()
        await page.getByPlaceholder('Search name, title or email…').fill(' Engineering ')
        await page.getByText(/Ben Ortega · Design Lead/).click()
        await focused('Ben Ortega').click()
        await page.getByRole('link', { name: 'View in org chart' }).click()
        await expect(focused('Ben Ortega')).toBeVisible()
        await page.getByLabel('Browse top-level teams').click()
        await page.getByText(/Maya Chen · VP Engineering/).click()
        await expect(focused('Maya Chen')).toBeVisible()
        await page.getByRole('radio', { name: 'Directory' }).click()
        const directorySearch = page.getByRole('textbox', { name: 'Search people...', exact: true })
        await directorySearch.focus()
        await directorySearch.press('ControlOrMeta+v')
        await expect(directorySearch).toHaveValue(boundedPaste)
        await page.waitForURL((url) => url.searchParams.get('search') === boundedPaste)
        const direct = new URL(path, baseUrl)
        const prefix = 'z'.repeat(199)
        direct.searchParams.set('search', `${prefix}😀legacy`)
        await page.goto(direct.href)
        await expect(directorySearch).toHaveValue(prefix)
        await expect.poll(() => searched.has(prefix)).toBe(true)
        assert(
          [...searched].every((term) => term.length <= 200),
          'People sent an oversized search'
        )
        await directorySearch.fill('Amara')
        const profileLink = page.getByRole('link', { name: 'Amara Cole', exact: true })
        await profileLink.focus()
        await page.keyboard.press('Enter')
        await page.getByRole('link', { name: 'Open Maya Chen' }).click()
        const backToResults = page
          .getByRole('link', { name: 'People', exact: true })
          .and(page.locator('a[href*="search=Amara"]'))
        await backToResults.click()
        await expect(directorySearch).toHaveValue('Amara')
        const chartOrigin = new URL(path, baseUrl)
        chartOrigin.searchParams.set('view', 'chart')
        chartOrigin.searchParams.set('focus', lead.memberId)
        chartOrigin.searchParams.set('page', '2')
        chartOrigin.searchParams.set('search', 'Amara')
        chartOrigin.searchParams.set('department', 'Engineering')
        await page.goto(chartOrigin.href)
        await focused('Maya Chen').click()
        await page
          .getByRole('link', { name: 'People', exact: true })
          .and(page.locator('a[href*="department=Engineering"]'))
          .click()
        await page.waitForURL(
          (url) =>
            url.pathname === path &&
            [...chartOrigin.searchParams].every(
              ([key, value]) => url.searchParams.get(key) === value
            )
        )
        await expect(page.getByRole('button', { name: 'Explore Lena Ali' })).toBeVisible()
        await page.goto(new URL(`${path}?search=Amara`, baseUrl).href)
        await directorySearch.fill('')
        await page.waitForURL(
          (url) => url.searchParams.get('view') === 'directory' && !url.searchParams.get('search')
        )
        await expect(page.getByRole('radio', { name: 'Directory' })).toBeChecked()
        await page.getByRole('radio', { name: 'Org chart' }).click()
        await page.goto(new URL(`${path}?focus=${unlinked.memberId}`, baseUrl).href)
        await page.getByText('No reporting lines for Rae Dunn').waitFor()
        await page.getByRole('button', { name: 'Explore a team' }).click()
        await expect(focused('Maya Chen')).toBeVisible()

        const empty = await browser.newPage({ viewport: { width: 1280, height: 800 } })
        empty.setDefaultTimeout(60_000)
        await empty
          .context()
          .addCookies([
            { name: 'better-auth.session_token', value: outsider.cookie, url: baseUrl.origin },
          ])
        await empty.goto(new URL(`/o/${outsider.orgId}/people`, baseUrl).href)
        await empty.getByText('No reporting lines yet', { exact: true }).waitFor()
        await empty.screenshot({ path: join(screenshotDir, 'empty-chart.png') })
        await empty.getByRole('button', { name: 'Import people', exact: true }).click()
        const picker = empty.getByRole('dialog', { name: 'Import people data' })
        await picker.getByRole('button', { name: 'Okta', exact: true }).waitFor()
        await expect(picker.getByRole('button', { name: 'SCIM provisioning' })).toHaveCount(0)
        await empty.screenshot({ path: join(screenshotDir, 'import-sources.png') })
        await picker.getByRole('button', { name: 'Microsoft Entra ID' }).click()
        await empty.getByRole('dialog', { name: 'Import from Microsoft Entra ID' }).waitFor()
        await empty.close()
        const mobile = await browser.newPage({
          isMobile: true,
          hasTouch: true,
          viewport: { width: 390, height: 844 },
        })
        mobile.setDefaultTimeout(60_000)
        await mobile
          .context()
          .addCookies([
            { name: 'better-auth.session_token', value: lead.cookie, url: baseUrl.origin },
          ])
        await mobile.goto(new URL(path, baseUrl).href, { waitUntil: 'domcontentloaded' })
        await mobile
          .getByRole('link', { name: 'View profile for Maya Chen' })
          .waitFor({ timeout: 120_000 })
        for (const width of [390, 320]) {
          await mobile.setViewportSize({ width, height: 844 })
          await expect(mobile.getByRole('button', { name: 'Explore Amara Cole' })).toBeVisible()
          await expect(mobile.getByRole('button', { name: 'Explore Ben Ortega' })).toHaveCount(0)
          await mobile.getByRole('button', { name: 'Next reports' }).tap()
          await expect(mobile.getByRole('button', { name: 'Explore Ben Ortega' })).toBeVisible()
          await mobile.getByRole('button', { name: 'Fit chart' }).tap()
          await mobile.screenshot({ path: join(screenshotDir, `mobile-${width}.png`) })
          assert(
            await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
          )
          await mobile.getByRole('button', { name: 'Previous reports' }).tap()
        }
        await mobile.getByRole('button', { name: 'Explore Amara Cole' }).tap()
        await mobile.getByRole('button', { name: 'Explore June Evans' }).tap()
        const trail = mobile.getByRole('navigation', { name: 'Reporting path' })
        const heading = trail.getByRole('heading', { name: 'June Evans' })
        await heading.scrollIntoViewIfNeeded()
        await expect(heading).toBeInViewport()
        const manager = trail.getByRole('button', { name: 'Maya Chen' })
        await manager.scrollIntoViewIfNeeded()
        await expect(manager).toBeInViewport()
        await manager.tap()
        await expect(mobile.getByRole('link', { name: 'View profile for Maya Chen' })).toBeVisible()
        assert(
          await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        )
      } finally {
        await browser.close()
      }
    })

  if (screenshotDir)
    await check(
      'a transient status poll preserves a credential draft until administrator access is revoked',
      async () => {
        const { chromium, expect } = await import('@playwright/test')
        const browser = await chromium.launch()
        try {
          await sql`insert into people_directory_sync (organization_id, source, source_target, next_sync_at)
          values (${teamOrg}, 'okta', 'draft.okta.com', now() + interval '1 hour')`
          const page = await browser.newPage()
          page.setDefaultTimeout(60_000)
          await page
            .context()
            .addCookies([
              { name: 'better-auth.session_token', value: lead.cookie, url: baseUrl.origin },
            ])
          const statusUrl = new URL(`/api/organizations/${teamOrg}/people/sync`, baseUrl).href
          const draft = `unsaved-e2e-${generateId()}`
          let transmitted = false
          page.on('request', (req) => {
            transmitted ||= [req.url(), req.postData() ?? '', ...Object.values(req.headers())].some(
              (value) => value.includes(draft)
            )
          })
          await page.clock.install()
          await page.goto(new URL(`/o/${teamOrg}/people?panel=sync`, baseUrl).href)
          await page.getByRole('button', { name: 'Update credentials' }).click()
          const token = page
            .getByRole('dialog', { name: 'Update Okta credentials' })
            .getByLabel('API token', { exact: true })
          await token.click()
          await token.fill(draft)

          let failures = 0
          await page.route(statusUrl, (route) => {
            if (route.request().method() === 'GET' && failures < 2) {
              failures++
              return route.fulfill({
                status: 503,
                json: { error: 'Directory status temporarily unavailable' },
              })
            }
            return route.continue()
          })
          const response = (code: number) =>
            page.waitForResponse((event) => event.url() === statusUrl && event.status() === code)
          const failed = response(503)
          await page.clock.fastForward(30_001)
          await failed
          await expect.poll(() => failures).toBe(2)
          const recovered = response(200)
          await page.clock.fastForward(30_001)
          await recovered
          await expect(token).toHaveValue(draft)

          await sql`update member set role='member' where id=${lead.memberId}`
          const denied = response(403)
          await page.clock.fastForward(30_001)
          await denied
          await expect(token).toHaveCount(0)
          assert.equal(
            transmitted,
            false,
            'Polling and revoking access must never transmit the unsaved credential'
          )
        } finally {
          await browser.close()
          await sql`update member set role='owner' where id=${lead.memberId}`
          await sql`delete from people_directory_sync where organization_id=${teamOrg}`
        }
      }
    )
}

async function cleanup() {
  if (organizationIds.length) {
    await sql`delete from audit_log where resource_id in ${sql(organizationIds)}`
    if (userIds.length) {
      await sql`delete from workspace where owner_id in ${sql(userIds)} or billed_account_user_id in ${sql(userIds)}`
      await sql`delete from project where owner_id in ${sql(userIds)}`
    }
    await sql`delete from project where organization_id in ${sql(organizationIds)}`
    await sql`delete from organization where id in ${sql(organizationIds)}`
  }
  if (userIds.length) await sql`delete from "user" where id in ${sql(userIds)}`
}

try {
  await run()
} catch (error) {
  logger.error('People E2E failed', { error: getErrorMessage(error) })
  process.exitCode = 1
} finally {
  try {
    await cleanup()
  } catch (error) {
    logger.error('People E2E fixture cleanup failed', { error: getErrorMessage(error) })
    process.exitCode = 1
  }
  await sql.end()
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    status: process.exitCode ? 'failed' : 'passed',
    transport: 'Real HTTP against a local Next.js app and PostgreSQL',
    requestCount,
    checks,
  }
  if (process.env.PEOPLE_E2E_REPORT_PATH) {
    await writeFile(process.env.PEOPLE_E2E_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  }
  logger.info(
    `People E2E ${report.status}: ${checks.filter((item) => item.status === 'passed').length}/${checks.length} checks, ${requestCount} HTTP requests`
  )
}
