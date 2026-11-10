import { expect, type Locator } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

test('Home can hide, undo, disconnect and reconnect widgets without losing the rest of the dashboard', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=full'))
  const email = page.getByRole('region', { name: 'Email', exact: true })
  await expect(page.getByRole('region', { name: 'Home dashboard' })).toHaveAttribute(
    'data-edges',
    'end'
  )
  const customize = page.getByRole('button', { name: 'Customize home' })
  await customize.hover()
  await expect(page.getByRole('tooltip', { name: 'Customize home' })).toBeVisible()
  await customize.click()
  await expect(page.getByRole('tooltip', { name: 'Customize home' })).toHaveCount(0)
  await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
  await expect(email).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await email.getByRole('button', { name: 'Email options' }).click()
  await page.getByRole('menuitem', { name: 'Disconnect Email' }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect Email' })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await expect(email.getByRole('button', { name: 'Gmail' })).toBeVisible()
  await email.getByRole('button', { name: 'Gmail' }).click()
  await expect(email.getByRole('button', { name: /Nina Patel/ })).toBeVisible()
  await page.getByRole('button', { name: 'Customize home' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Review the renewal brief', exact: true }).click()
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(email).toHaveCount(0)
})

test('Now restores today’s time after scrolling the calendar or viewing another day', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=full'))
  const calendar = page.getByRole('region', { name: 'Calendar', exact: true })
  const schedule = calendar.getByRole('region', { name: 'Calendar schedule' })
  const now = calendar.getByRole('button', { name: 'Now', exact: true })
  const currentTime = schedule.getByLabel('Current time')
  await schedule.scrollIntoViewIfNeeded()
  await expect(currentTime).toBeInViewport()
  await expect(now).toHaveCount(0)
  const restingTop = await schedule.evaluate((el) => el.scrollTop)
  await schedule.evaluate((el) => el.scrollBy(0, 12))
  await expect(currentTime).toBeInViewport()
  await expect(now).toBeVisible()
  await schedule.evaluate((el, top) => el.scrollTo(0, top), restingTop)
  await expect(now).toHaveCount(0)
  await schedule.press('End')
  await expect(now).toBeVisible()
  await now.press('Enter')
  await expect(now).toHaveCount(0)
  await expect(currentTime).toBeInViewport()
  await expect(schedule).toBeFocused()

  await calendar.getByRole('button', { name: 'Next day' }).click()
  await expect(now).toBeVisible()
  await expect(schedule.getByRole('article')).toHaveCount(0)
  for (const [key, time, edges] of [
    ['End', '11:00 PM', 'start'],
    ['Home', '12:00 AM', 'end'],
  ] as const) {
    await schedule.focus()
    await schedule.press(key)
    await expect(schedule).toHaveAttribute('data-edges', edges)
    await expect(schedule.getByText(time, { exact: true })).toBeInViewport()
  }
  await now.click()
  await expect(now).toHaveCount(0)
  await expect(currentTime).toBeInViewport()
  await schedule.getByText('Customer operations review', { exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const people = calendar
    .getByRole('group', { name: 'People in this meeting', exact: true })
    .first()
  await expect(people.getByRole('button')).toHaveCount(0)
  const overflow = people.getByLabel('1 other', { exact: true })
  await expect(overflow).toHaveText('+1')
  await overflow.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await people.getByRole('img', { name: 'Nina Patel', exact: true }).hover()
  await expect(page.getByRole('tooltip', { name: 'Nina Patel', exact: true })).toBeVisible()
})

test('Home fills the available chart column and keeps calendar day controls on the same baseline', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=full'))
  const chart = page.getByRole('region', { name: 'Tasks run' })
  const email = page.getByRole('region', { name: 'Email', exact: true })
  const tasks = page.getByRole('region', { name: 'Needs your attention' })
  const calendar = page.getByRole('region', { name: 'Calendar', exact: true })
  await expect(chart).toBeVisible()
  for (const width of [390, 768, 1040, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(async () => {
      const sections = await chart
        .or(email)
        .or(tasks)
        .or(calendar)
        .evaluateAll((elements) =>
          elements.map((el) => {
            const { x, y, width } = el.getBoundingClientRect()
            return { x, y, width, label: el.getAttribute('aria-label') }
          })
        )
      const buttons = calendar.getByRole('button', { name: /^(Previous|Next) day$/ })
      const centers = await buttons.evaluateAll((elements) =>
        elements.map((el) => {
          const { y, height } = el.getBoundingClientRect()
          return y + height / 2
        })
      )
      expect(sections.map((section) => section.label)).toEqual([
        'Tasks run',
        'Email',
        'Needs your attention',
        'Calendar',
      ])
      if (width < 1440) expect(sections[1].y).toBeLessThan(sections[2].y)
      else {
        expect(sections[0].y).toBeCloseTo(sections[2].y, 0)
        expect(sections[1].x).toBeLessThan(sections[3].x)
      }
      expect(centers).toHaveLength(2)
      expect(sections[0].width).toBeGreaterThan(0)
      expect(sections[0].x).toBeCloseTo(sections[1].x, 0)
      expect(sections[0].width).toBeCloseTo(sections[1].width, 0)
      expect(centers[0]).toBeCloseTo(centers[1], 0)
    }).toPass({ timeout: 5000 })
  }
})

test('the sidebar opener stays in place while Home scrolls and keeps its reading position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto(fixtureUrl('/home?state=full'))
  const home = page.getByRole('region', { name: 'Home dashboard' })
  const opener = page.getByRole('button', { name: 'Expand sidebar' })
  await expect(opener).toBeVisible()
  const resting = await opener.boundingBox()
  if (!resting) throw new Error('The sidebar opener must be visible')
  const offset = await home.evaluate((el) => {
    el.scrollTop = el.clientHeight / 2
    return el.scrollTop
  })
  expect(offset).toBeGreaterThan(0)
  await expect(home).toHaveAttribute('data-edges', 'both')
  expect(await opener.boundingBox()).toEqual(resting)
  await page.mouse.click(resting.x + resting.width / 2, resting.y + resting.height / 2)
  await expect(page.getByRole('dialog', { name: 'Navigation drawer' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  expect(await home.evaluate((el) => el.scrollTop)).toBe(offset)
  await page.getByRole('button', { name: 'Add attachment' }).click()
  await expect(page.getByRole('menuitem', { name: 'Upload files' })).toBeVisible()
})

test('clipped mail fades sideways inside the scrolling Home dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await page.goto(fixtureUrl('/home?state=full'))
  const home = page.getByRole('region', { name: 'Home dashboard' })
  const row = home.getByRole('button', { name: /Nina Patel.*Updated onboarding checklist/ })
  await expect(home).toHaveAttribute('data-edges', 'end')
  await row.getByText('Updated onboarding checklist', { exact: true }).hover()
  const tooltip = page.locator('[role=tooltip]:visible')
  await expect(tooltip).toContainText('kickoff on Thursday')
  await expect(row).toHaveAccessibleName(/kickoff on Thursday/)
  const visibleLines = await tooltip.evaluate((el) => {
    const css = getComputedStyle(el)
    return (
      (el.clientHeight - Number.parseFloat(css.paddingTop) - Number.parseFloat(css.paddingBottom)) /
      Number.parseFloat(css.lineHeight)
    )
  })
  expect(visibleLines).toBeLessThanOrEqual(3)
  await expect
    .poll(() =>
      row.evaluate((el) =>
        Array.from(el.querySelectorAll('*'))
          .map((child) => getComputedStyle(child).maskImage)
          .filter((mask) => mask !== 'none')
      )
    )
    .toContainEqual(expect.stringMatching(/to right/))
  const inbox = home.getByRole('region', { name: 'Email messages' })
  const outerOffset = await home.evaluate((el) => el.scrollTop)
  await expect(inbox).toHaveAttribute('data-edges', 'end')
  await inbox.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(inbox).toHaveAttribute('data-edges', 'start')
  expect(await home.evaluate((el) => el.scrollTop)).toBe(outerOffset)
  await home.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(home).toHaveAttribute('data-edges', 'start')
  await home.evaluate((el) => {
    el.scrollTop /= 2
  })
  await expect(home).toHaveAttribute('data-edges', 'both')
})

test('a new chat carries its local draft and attachments through navigation without putting the message in the URL', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?theme=dark&state=full'))
  const attach = page.getByRole('button', { name: 'Add attachment' })
  await attach.click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Upload files' }).click()
  await (await chooser).setFiles({
    name: 'meeting.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Two open questions'),
  })
  const text = page.getByRole('textbox', { name: /Ask about your business/ })
  await text.fill('Integrate @sla')
  await expect(page.getByRole('option', { name: /Slack/ }).first()).toBeVisible()
  await expect(text).toBeFocused()
  await text.press('Enter')
  await expect(text).toHaveValue('Integrate @Slack ')
  await text.pressSequentially('using /week')
  await page
    .getByRole('option', { name: /weekly-review/ })
    .first()
    .click()
  await expect(text).toHaveValue('Integrate @Slack using /weekly-review ')
  await text.press('Backspace')
  await text.press('Backspace')
  await expect(text).toHaveValue('Integrate @Slack using ')
  await text.press('ControlOrMeta+z')
  await expect(text).toHaveValue('Integrate @Slack using /weekly-review')
  await text.press('Backspace')
  await expect(text).toHaveValue('Integrate @Slack using ')
  await attach.click()
  await page.getByPlaceholder('Search resources').fill('Account briefs')
  await page.getByRole('menuitem', { name: /Account briefs/ }).click()
  await expect(text).toBeFocused()
  await page.keyboard.type('today')
  await expect(text).toHaveValue('Integrate @Slack using @Account briefs today')
  await page.getByRole('radio', { name: 'Search', exact: true }).check()
  const search = page.getByRole('textbox', { name: /Search your company/ })
  await search.fill('Draft the meeting recap')
  await page.getByRole('link', { name: 'Q4 planning', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Q4 planning' })).toBeVisible()
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Search', exact: true })).toBeChecked()
  await expect(search).toHaveValue('Draft the meeting recap')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/chat\/[^?]+\?/)
  expect(page.url()).not.toContain('meeting')
  await expect(page.getByRole('heading', { name: 'Draft the meeting recap' })).toBeVisible()
  await page.getByRole('button', { name: 'Preview meeting.txt' }).click()
  const preview = page.getByRole('dialog', { name: 'meeting.txt' })
  await expect(preview.getByText('Two open questions')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: 'Ask a follow-up…' }).fill('Include the owner')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Include the owner', { exact: true })).toBeVisible()
})

test('each message reveals its own footer across the text and the gap to its actions', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/chat/weekly-review?state=full'))
  const prompt = page.getByText(/^Review the renewal brief for Aster Labs/)
  const answer = page.getByText(/^The renewal is in good shape/)
  const userTime = page.getByText('3:46 PM', { exact: true })
  const responseTime = page.getByText('4:04 PM', { exact: true })
  const visible = (control: Locator) =>
    control.evaluate((element) => element.checkVisibility({ opacityProperty: true }))

  await prompt.hover()
  expect(await visible(userTime)).toBe(true)
  expect(await visible(responseTime)).toBe(false)
  const [bubble, copy] = await Promise.all([
    prompt.boundingBox(),
    page.getByRole('button', { name: 'Copy message', exact: true }).boundingBox(),
  ])
  if (!bubble || !copy) throw new Error('The prompt and its footer must be on screen')
  await page.mouse.move(bubble.x + bubble.width / 2, (bubble.y + bubble.height + copy.y) / 2)
  expect(await visible(userTime)).toBe(true)
  await answer.hover()
  expect(await visible(responseTime)).toBe(true)
  expect(await visible(userTime)).toBe(false)
  await page.getByRole('button', { name: 'Copy response', exact: true }).hover()
  expect(await visible(responseTime)).toBe(true)
  await page.getByRole('heading', { name: 'Review the renewal brief' }).hover()
  expect(await visible(responseTime)).toBe(false)
})

test('chat activity, recovery, and feedback controls work at intermediate and narrow widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 647, height: 790 })
  await page.goto(fixtureUrl('/chat/weekly-review?state=full'))
  async function linePlacement(line: Locator) {
    await expect(line).toBeVisible()
    return line.evaluate((element) => {
      const turn = element.closest('article')
      if (!turn) throw new Error('A response belongs to a chat turn')
      const start = turn.getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      const css = getComputedStyle(element)
      return [bounds.x - start.x, bounds.y - start.y, css.font, css.color]
    })
  }
  const regular = await linePlacement(page.getByText(/^The renewal is in good shape/))
  await page.getByText('Worked for 38s', { exact: true }).click()
  const thinking = page.getByText(/^Compared the renewal terms/)
  expect(await linePlacement(thinking)).toEqual(regular)
  const gaps = await thinking.evaluate((first) => {
    const turn = first.closest('article')
    if (!turn) throw new Error('Missing chat turn')
    const lines = Array.from(turn.querySelectorAll('p, summary')).filter(
      (line) => line.getClientRects().length > 0
    )
    const bounds = lines.slice(lines.indexOf(first)).map((line) => line.getBoundingClientRect())
    return bounds.slice(1).map((next, index) => next.top - bounds[index].bottom)
  })
  expect(gaps.length).toBeGreaterThan(1)
  expect(Math.min(...gaps)).toBeGreaterThan(0)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1)
  await page.locator('summary').filter({ hasText: 'Read renewal-brief.pdf' }).click()
  const input = page.locator('dd code').filter({ hasText: '"pages"' })
  await expect(input).toBeVisible()
  expect(JSON.parse(await input.innerText())).toEqual({ file: 'renewal-brief.pdf', pages: '1–12' })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const result = page.locator('details[open] dl').filter({ has: input })
  for (const [index, label] of ['Copy tool input', 'Copy tool response'].entries()) {
    const value = await result.locator('dd code').nth(index).innerText()
    await result.getByRole('button', { name: label, exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value)
  }
  await expect(result.getByRole('button', { name: 'Copied', exact: true })).toHaveCount(2)
  await expect(result.getByRole('button', { name: /^Copy tool / })).toHaveCount(2, {
    timeout: 7_000,
  })
  const answer = await page.getByText(/^The renewal is in good shape/).boundingBox()
  const copy = await page
    .getByRole('button', { name: 'Copy response', exact: true })
    .locator('svg')
    .boundingBox()
  if (!answer || !copy) throw new Error('The response and its copy control must be visible')
  expect(copy.x).toBeCloseTo(answer.x, 0)
  await page.getByRole('button', { name: 'Rate response' }).click()
  await page.getByRole('menuitem', { name: 'Bad response' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share feedback' })
  const feedback = dialog.getByRole('textbox', { name: 'Details' })
  await feedback.fill('The ownership change was missing.\n'.repeat(40))
  await feedback.evaluate((field) => {
    field.scrollTop = 0
  })
  await expect(feedback).toHaveAttribute('data-edges', 'end')
  await feedback.evaluate((field) => {
    if (!(field instanceof HTMLTextAreaElement) || !field.form)
      throw new Error('Missing feedback form')
    field.form.reset()
  })
  await expect(feedback).toHaveValue('')
  await expect(feedback).toHaveCSS('mask-image', 'none')
  await feedback.fill('The ownership change was missing.')
  await dialog.getByRole('button', { name: 'Send feedback' }).click()
  await expect(dialog).not.toBeVisible()
  await page.setViewportSize({ width: 356, height: 740 })
  await page.goto(fixtureUrl('/chat/october-close?theme=dark&state=full'))
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.getByRole('button', { name: 'Stop response' }).click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
})

test('stress transcript keeps attachment review bounded and returns the reader to the latest prompt', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(fixtureUrl('/chat/weekly-review?state=stress'))
  await page
    .getByRole('button', { name: /20 attachments.*Show all/ })
    .last()
    .click()
  await expect(page.getByRole('button', { name: 'Remove Review document 20' })).toBeAttached()
  const reading = page.locator('article').first()
  await reading.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Jump to latest' }).click()
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeHidden()
})

test('collapsing work preserves prose and a long follow-up leaves the active run stoppable', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/chat/customer-onboarding?state=full'))
  const editor = page.getByRole('textbox', { name: 'Add a follow-up…' })
  const progress = page.getByText(/checking for unresolved/)
  await expect(progress).toBeVisible()
  const prose = await progress.boundingBox()
  const step = await page
    .locator('summary')
    .filter({ hasText: 'Read renewal-brief.pdf' })
    .boundingBox()
  if (!prose || !step) throw new Error('The running update and its tool must both be visible')
  expect(prose.y + prose.height).toBeLessThanOrEqual(step.y)
  await page.getByText(/^Working for /).click()
  await expect(progress).toBeVisible()
  const message = 'Include the handoff and its owner. '.repeat(25).trim()
  await editor.fill(message)
  await editor.press('Enter')
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop response' }).click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
})

test('unsent drafts and files stay with their chat through navigation and clear after sending', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/chat/weekly-review?state=full'))
  const editor = page.getByRole('textbox', { name: 'Ask a follow-up…' })
  await editor.fill('Review before sending')
  await page.getByRole('button', { name: 'Add attachment' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Upload files' }).click()
  await (await chooser).setFiles({
    name: 'handoff.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Available offline'),
  })
  await page.getByRole('link', { name: 'Q4 planning' }).click()
  await expect(editor).toBeEmpty()
  await expect(page.getByRole('button', { name: 'Preview handoff.txt' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Review the renewal brief', exact: true }).click()
  await expect(editor).toHaveValue('Review before sending')
  await page.getByRole('button', { name: 'Preview handoff.txt' }).click()
  await expect(page.getByRole('dialog').getByText('Available offline')).toBeVisible()
  await page.keyboard.press('Escape')
  await editor.press('Enter')
  await expect(page.getByText('Review before sending', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Q4 planning' }).click()
  await page.getByRole('link', { name: 'Review the renewal brief', exact: true }).click()
  await expect(editor).toBeEmpty()
  await expect(page.getByRole('button', { name: 'Remove handoff.txt' })).toHaveCount(0)
})

test.describe('touch composer', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('Return inserts a newline and sending consumes the original attachment batch', async ({
    page,
  }) => {
    await page.goto(fixtureUrl('/chat?state=stress'))
    const editor = page.getByRole('textbox', { name: /Ask about your business/ })
    await editor.fill('Review the attached files')
    await editor.press('Enter')
    await expect(editor).toHaveValue('Review the attached files\n')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByRole('heading', { name: 'Review the attached files' })).toBeVisible()
    await expect(page.getByRole('button', { name: /20 attachments.*Show all/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })
})
