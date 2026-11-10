import { expect, type Page } from '@playwright/test'
import { generateId } from '@sim/utils/id'
import { adminEmail, signInAsAdmin } from '@/platform/checks/live/session'
import { withLiveDatabase } from '@/platform/checks/live/support/database'
import { test } from '@/platform/checks/test'

const WORKSPACE_ID = '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b01'

/**
 * Seeds a workflow with no blocks in the main workspace, owned by the administrator, opens its
 * editor and deletes it afterwards. An empty workflow shows the canvas command list once the
 * canvas is ready to edit, which is what each check waits for.
 */
async function withEmptyWorkflow(page: Page, work: () => Promise<void>) {
  const workflowId = `platform-live-workflow-${generateId()}`
  await withLiveDatabase(
    (sql) => sql`insert into workflow
      (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
      values (${workflowId}, (select id from "user" where email = ${adminEmail()}), ${WORKSPACE_ID},
        'Block search check', now(), now(), now())`
  )
  try {
    await signInAsAdmin(page, `/workspace/${WORKSPACE_ID}/workflows/${workflowId}`)
    await expect(page.getByRole('button', { name: /^Search blocks/ })).toBeVisible()
    await work()
  } finally {
    await withLiveDatabase((sql) => sql`delete from workflow where id = ${workflowId}`)
  }
}

const workflowPanel = (page: Page) => page.getByRole('complementary', { name: 'Workflow panel' })

/** Opens the right panel's Variables tab, so a check starts with the Toolbar's pane hidden. */
async function leaveToolbarTab(page: Page) {
  const variables = workflowPanel(page).getByRole('tab', { name: 'Variables', exact: true })
  await variables.click()
  await expect(variables).toHaveAttribute('aria-selected', 'true')
  return variables
}

/** The Toolbar tab is selected and its block search holds focus. */
async function expectToolbarSearchFocused(page: Page) {
  const panel = workflowPanel(page)
  await expect(panel.getByRole('tab', { name: 'Toolbar', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(panel.getByRole('searchbox', { name: 'Search toolbar' })).toBeFocused()
}

test('Add block in the canvas menu opens the Toolbar tab with its search focused', async ({
  page,
}) => {
  await withEmptyWorkflow(page, async () => {
    const variables = await leaveToolbarTab(page)
    // A corner of the pane, clear of the command list in its centre.
    await page.getByRole('application').click({ button: 'right', position: { x: 48, y: 48 } })
    const menu = page.getByRole('menu', { name: 'Canvas actions' })
    await expect(menu).toBeVisible()
    await expect(variables).toHaveAttribute('aria-selected', 'true')
    await menu.getByRole('menuitem', { name: /^Add block/ }).click()
    await expectToolbarSearchFocused(page)
    // The menu returns focus as it unmounts, so focus must still be in the search once it has gone.
    await expect(menu).toBeHidden()
    await expectToolbarSearchFocused(page)
  })
})

test('Search blocks on an empty canvas opens the Toolbar tab with its search focused', async ({
  page,
}) => {
  await withEmptyWorkflow(page, async () => {
    await leaveToolbarTab(page)
    await page.getByRole('button', { name: /^Search blocks/ }).click()
    await expectToolbarSearchFocused(page)
  })
})
