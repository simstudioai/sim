import { expect, test } from '@playwright/test'

const populated = 'http://127.0.0.1:3181'

test('Home can hide, undo, disconnect and reconnect widgets without losing the rest of the dashboard', async ({
  page,
}) => {
  await page.goto(`${populated}/home?state=full`)
  const email = page.getByRole('region', { name: 'Email', exact: true })
  await page.getByRole('button', { name: 'Customize Home' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
  await expect(email).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await email.getByRole('button', { name: 'Email options' }).click()
  await page.getByRole('menuitem', { name: 'Disconnect Email' }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect Email?' })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await expect(email.getByRole('button', { name: 'Gmail' })).toBeVisible()
  await email.getByRole('button', { name: 'Gmail' }).click()
  await expect(email.getByRole('button', { name: /Nina Patel/ })).toBeVisible()
  await page.getByRole('button', { name: 'Customize Home' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Review the renewal brief', exact: true }).click()
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(email).toHaveCount(0)
  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(page.getByText('No meetings today')).toBeVisible()
  await page.getByRole('button', { name: 'Previous day' }).click()
  await page.getByRole('button', { name: 'Show 2 more people' }).hover()
  await expect(page.getByRole('tooltip').getByText('Nina Patel')).toBeVisible()
})

test('a new chat carries its local draft and attachments through navigation without putting the message in the URL', async ({
  page,
}) => {
  await page.goto(`${populated}/home?theme=dark&state=full`)
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
  await text.fill('/')
  const chatsMenu = page.getByRole('menuitem', { name: 'Chats', exact: true })
  await expect(chatsMenu).toBeVisible()
  await page.keyboard.type('notes')
  await expect(text).toHaveValue('/notes')
  await expect(chatsMenu).toHaveCount(0)
  await text.fill('/')
  await chatsMenu.hover()
  await page.getByRole('menuitem', { name: 'Review the renewal brief' }).click()
  await page.getByRole('button', { name: 'Remove Review the renewal brief' }).click()
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

test('chat activity, recovery, and feedback controls work at intermediate and narrow widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 647, height: 790 })
  await page.goto(`${populated}/chat/weekly-review?state=full`)
  await page.getByText('Worked for 38s', { exact: true }).click()
  await page.locator('summary').filter({ hasText: 'Read renewal-brief.pdf' }).click()
  await expect(
    page.getByText('{"file":"renewal-brief.pdf","pages":"1–12"}', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Rate response' }).click()
  await page.getByRole('menuitem', { name: 'Bad response' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share feedback' })
  await dialog.getByRole('textbox', { name: 'Details' }).fill('The ownership change was missing.')
  await dialog.getByRole('button', { name: 'Send feedback' }).click()
  await expect(dialog).not.toBeVisible()
  await page.setViewportSize({ width: 356, height: 740 })
  await page.goto(`${populated}/chat/october-close?theme=dark&state=full`)
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
  await page.goto(`${populated}/chat/weekly-review?state=stress`)
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

test('a follow-up leaves the active run stoppable', async ({ page }) => {
  await page.goto(`${populated}/chat/customer-onboarding?state=full`)
  const editor = page.getByRole('textbox', { name: 'Add a follow-up…' })
  await editor.fill('Also include the handoff')
  await editor.press('Enter')
  await expect(page.getByText('Also include the handoff', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop response' }).click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0)
})

test('unsent drafts and files stay with their chat through navigation and clear after sending', async ({
  page,
}) => {
  await page.goto(`${populated}/chat/weekly-review?state=full`)
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
    await page.goto(`${populated}/chat?state=stress`)
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
