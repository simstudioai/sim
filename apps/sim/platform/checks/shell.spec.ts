import { expect, type Locator, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

async function expectSidebarInsets(sidebar: Locator) {
  const scroll = sidebar.getByRole('region', { name: 'Platform navigation' })
  const [frame, header, navigation, footer] = await Promise.all([
    sidebar.boundingBox(),
    sidebar.getByRole('button', { name: 'Organization menu' }).boundingBox(),
    scroll.boundingBox(),
    sidebar.locator('footer').boundingBox(),
  ])
  if (!frame || !header || !navigation || !footer) throw new Error('The sidebar must be visible')
  expect(header.y - frame.y).toBe(12)
  expect(footer.y - (navigation.y + navigation.height)).toBe(12)
  expect(frame.y + frame.height - (footer.y + footer.height)).toBe(12)
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const lastChat = await scroll
    .getByRole('region', { name: 'Chats', exact: true })
    .getByRole('link')
    .last()
    .boundingBox()
  if (!lastChat) throw new Error('The populated sidebar needs a final chat')
  expect(footer.y - (lastChat.y + lastChat.height)).toBe(12)
  await scroll.evaluate((element) => {
    element.scrollTop = 0
  })
}

test('a keyboard search navigates to the matching chat and shell edits survive the return trip', async ({
  page,
}) => {
  await page.goto(`${origin}/home?state=full&theme=dark`)
  const trigger = page.getByRole('button', { name: 'Search', exact: true })
  await trigger.click()
  await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Control+k')
  const search = page.getByRole('combobox', { name: 'Search the platform' })
  await expect(search).toBeFocused()
  const list = page.getByRole('listbox', { name: 'Search results' })
  await expect(list).not.toHaveCSS('mask-image', 'none')
  const initialFade = await list.evaluate((element) => getComputedStyle(element).maskImage)
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(list).not.toHaveCSS('mask-image', initialFade)
  await search.fill('missing destination '.repeat(30))
  await expect(search).toHaveCSS('mask-image', /to right/)
  await expect(page.getByText('No results found')).toBeVisible()
  await search.fill('')
  await expect(search).toHaveCSS('mask-image', 'none')
  await search.fill('renewal')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(list).toHaveCSS('mask-image', 'none')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/chat\/weekly-review\?state=full&theme=dark/)
  const collection = page.getByRole('region', { name: 'Chats', exact: true })
  await collection.getByRole('link', { name: 'Review the renewal brief' }).hover()
  await collection.getByRole('button', { name: 'Actions for Review the renewal brief' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Chat name' }).fill('Renewal follow-up')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Renewal follow-up' })).toBeVisible()
  const workspaces = page.getByRole('region', { name: 'Workspaces', exact: true })
  const workspaceLabel = workspaces.locator('summary')
  await workspaceLabel.click()
  await trigger.hover()
  await expect(workspaceLabel.locator('svg:visible')).toHaveCount(0)
  await workspaces.getByRole('button', { name: 'Sort workspaces' }).hover()
  await expect(workspaceLabel.locator('svg:visible')).toHaveCount(1)
  await collection.locator('summary').click()
  await page.getByRole('button', { name: 'Organization menu' }).click()
  await page
    .getByRole('dialog', { name: 'Organization menu' })
    .getByRole('button', { name: 'Settings' })
    .click()
  await page.getByRole('button', { name: 'Back to app' }).click()
  await expect(page.getByRole('button', { name: 'Customize Home' })).toBeVisible()
  await expect(workspaces.getByRole('link', { name: 'Customer operations' })).toBeHidden()
  await expect(collection.getByRole('link', { name: 'Renewal follow-up' })).toBeHidden()
  await collection.locator('summary').click()
  await expect(collection.getByRole('link', { name: 'Renewal follow-up' })).toBeVisible()
  await expect(workspaces.getByRole('link', { name: 'Customer operations' })).toBeHidden()
  await collection.getByRole('link', { name: 'Renewal follow-up' }).hover()
  await collection.getByRole('button', { name: 'Actions for Renewal follow-up' }).click()
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  await page
    .getByRole('dialog', { name: 'Archive chat' })
    .getByRole('button', { name: 'Archive', exact: true })
    .click()
  await expect(collection.getByRole('link', { name: 'Renewal follow-up' })).toHaveCount(0)
})

test('the narrow drawer returns focus on Escape, routes through settings, and keeps nesting inside the viewport', async ({
  page,
}) => {
  for (const width of [356, 730]) {
    await page.setViewportSize({ width, height: 640 })
    await page.goto(`${origin}/home?state=stress&theme=light`)
    const toggle = page.getByRole('button', { name: 'Expand sidebar' })
    const openerHeight = (await toggle.boundingBox())?.height
    await toggle.click()
    const drawer = page.getByRole('dialog', { name: 'Navigation drawer' })
    await expect(drawer).toBeVisible()
    await expectSidebarInsets(drawer.getByRole('complementary', { name: 'Platform sidebar' }))
    const org = drawer.getByRole('button', { name: 'Organization menu' })
    const rowHeight = (await org.boundingBox())?.height
    for (const name of ['Search', 'Notifications', 'Collapse sidebar', 'Help']) {
      const box = await drawer.getByRole('button', { name, exact: true }).boundingBox()
      expect(box?.height).toBe(rowHeight)
      expect(box?.width).toBe(rowHeight)
    }
    expect(openerHeight).toBe(rowHeight)
    const help = drawer.getByRole('button', { name: 'Help', exact: true })
    const anchor = await help.boundingBox()
    await help.click()
    const download = page.getByRole('menuitem', { name: 'Download apps' })
    await expect(download).toBeVisible()
    expect(await help.boundingBox()).toEqual(anchor)
    await download.hover()
    const child = page.getByRole('menuitem', { name: 'Sim for macOS' })
    await expect(child).toBeVisible()
    const bounds = await child.boundingBox()
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBe(true)
    await child.press('Escape')
    await download.press('Escape')
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await expect(toggle).toBeFocused()
    await toggle.click()
    await drawer.getByRole('button', { name: 'Organization menu' }).click()
    await page
      .getByRole('dialog', { name: 'Organization menu' })
      .getByRole('button', { name: 'Settings' })
      .click()
    await expect(page).toHaveURL(/\/settings\/members\?state=stress&theme=light/)
    await expect(drawer).not.toBeVisible()
  }
})

test('sidebar and panel row actions share a hit area and act independently of the row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`${origin}/chat/weekly-review?state=full`)
  const sidebar = page.getByRole('complementary', { name: 'Platform sidebar' })
  await expectSidebarInsets(sidebar)
  const panel = page.getByRole('complementary', { name: 'Chat panel' })
  await page.getByRole('button', { name: 'Open chat panel' }).click()
  const workspace = sidebar.getByRole('link', { name: 'Customer operations', exact: true })
  const menu = sidebar.getByRole('button', { name: 'Actions for Customer operations' })
  const recent = panel.getByRole('button', { name: 'Renewal brief', exact: true })
  const remove = panel.getByRole('button', { name: 'Remove Renewal brief from recents' })
  const pairs = [
    [workspace, menu, false],
    [
      sidebar.getByRole('link', { name: 'Review the renewal brief' }),
      sidebar.getByRole('button', { name: 'Actions for Review the renewal brief' }),
      false,
    ],
    [
      panel.getByRole('tab', { selected: true }),
      panel.getByRole('button', { name: 'Close Workspaces tab' }),
      false,
    ],
    [recent, remove, true],
  ] as const
  const targets = []
  for (const [row, action, leading] of pairs) {
    await row.hover()
    await expect(action).toBeVisible()
    const host = await row.boundingBox()
    const hit = await action.boundingBox()
    if (!host || !hit) throw new Error('The row and its action must both be visible')
    targets.push([
      host.height,
      hit.width,
      hit.height,
      leading ? hit.x - host.x : host.x + host.width - hit.x - hit.width,
    ])
  }
  for (const target of targets) expect(target).toEqual(targets[0])
  await remove.click()
  await expect(recent).toHaveCount(0)
  await expect(panel.getByRole('tab', { selected: true })).toHaveAccessibleName('Workspaces')
  await workspace.hover()
  await menu.click()
  await page.getByRole('menuitem', { name: 'Open workspace' }).click()
  await expect(page).toHaveURL(/\/home\?state=full/)
})

test('the inbox filters unread items and each notification can be dismissed separately', async ({
  page,
}) => {
  await page.goto(`${origin}/home?state=full`)
  const open = page.getByRole('button', { name: 'Notifications', exact: true })
  await open.click()
  const inbox = page.getByRole('dialog', { name: 'Notifications', exact: true })
  const titleX = await inbox
    .getByRole('heading', { name: 'Inbox' })
    .evaluate((element) => element.getBoundingClientRect().x)
  const leadingIconX = await inbox
    .getByRole('button', { name: /Review the onboarding/ })
    .locator('svg')
    .first()
    .evaluate((element) => element.getBoundingClientRect().x)
  expect(leadingIconX).toBe(titleX)
  await inbox.getByRole('radio', { name: 'Unread' }).check()
  await expect(inbox.getByRole('button', { name: /Review the renewal brief/ })).toHaveCount(0)
  await inbox.getByRole('button', { name: /Reconnect Salesforce/ }).click()
  await page.getByRole('link', { name: 'Review the renewal brief' }).click()
  await expect(page.getByRole('heading', { name: 'Review the renewal brief' })).toBeVisible()
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Customize Home' })).toBeVisible()
  await open.click()
  await expect(inbox.getByRole('radio', { name: 'Unread' })).toBeChecked()
  await expect(inbox.getByRole('button', { name: /Reconnect Salesforce/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const customize = page.getByRole('button', { name: 'Customize Home', exact: true })
  await customize.click()
  await page.getByRole('menuitemcheckbox', { name: 'Email', exact: true }).click()
  const notices = page.getByRole('region', { name: 'Notification stack' })
  await expect(notices.getByRole('article', { name: 'Email hidden' })).toBeVisible()
  await page.getByRole('menuitemcheckbox', { name: 'Calendar', exact: true }).click()
  await page.keyboard.press('Escape')
  await notices.getByRole('button', { name: '4 notifications' }).click()
  await notices.getByRole('button', { name: 'Dismiss Syncing knowledge' }).click()
  const chats = page.getByRole('region', { name: 'Chats', exact: true })
  const names = await chats.getByRole('link').allTextContents()
  await page.getByRole('button', { name: 'Sort chats' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Name (A–Z)' }).click()
  await page.getByRole('button', { name: 'Emir Karabeg' }).click()
  await page.getByRole('button', { name: 'Back to app' }).click()
  await expect(chats.getByRole('link')).toHaveText([...names].sort((a, b) => a.localeCompare(b)))
  await expect(notices.getByRole('button', { name: '3 notifications' })).toBeVisible()
  await notices
    .getByRole('article', { name: 'Email hidden' })
    .getByRole('button', { name: 'Undo' })
    .click()
  await expect(page.getByRole('heading', { name: 'Email', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toHaveCount(0)
  await notices.getByRole('button', { name: '2 notifications' }).click()
  await expect(notices.getByRole('button', { name: 'Dismiss Workspace updated' })).toHaveCount(0)
  await notices.getByRole('button', { name: '2 notifications' }).click()
  await expect(notices.getByRole('button', { name: 'Dismiss Workspace updated' })).toBeVisible()
})
