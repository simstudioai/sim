import {
  buildRetentionPutBody,
  captureConfiguredRetention,
  SETTINGS_PRIMARY_RETENTION_BASELINE,
} from '../../support/data-retention'
import {
  expectDataRetentionReady,
  getOrganizationRetention,
  newPersonaPage,
  primaryWorldIds,
  restoreOrganizationRetention,
  selectLabeledOption,
  waitForSameOriginResponse,
} from './helpers'
import { expect, test } from './workflow-test'

const SAVED_DEFAULTS = {
  logRetentionHours: 7 * 24,
  softDeleteRetentionHours: 14 * 24,
  taskCleanupHours: 60 * 24,
} as const

test('organization retention and one-field workspace override restore their exact baseline', async ({
  contextForPersona,
  personaManifest,
  registerCleanup,
}) => {
  const ids = primaryWorldIds(personaManifest)
  const workspaceName =
    personaManifest.worlds['settings-primary'].workspaceIdentities['enterprise-workspace'].name
  const { context, page } = await newPersonaPage(contextForPersona, 'enterpriseOrganizationAdmin')
  const baseline = captureConfiguredRetention(
    await getOrganizationRetention(context.request, ids.enterpriseOrganizationId)
  )
  expect(baseline).toEqual(SETTINGS_PRIMARY_RETENTION_BASELINE)

  registerCleanup('restore exact organization retention snapshot', () =>
    restoreOrganizationRetention(context.request, ids.enterpriseOrganizationId, baseline)
  )

  await page.goto(
    `/organization/${encodeURIComponent(ids.enterpriseOrganizationId)}/settings/data-retention`
  )
  let retention = await expectDataRetentionReady(page)
  await retention.getByRole('button', { name: 'Edit organization retention policy' }).click()

  await selectLabeledOption(retention, 'Organization log retention', '1 day')
  await selectLabeledOption(retention, 'Organization soft deletion cleanup', '3 days')
  await selectLabeledOption(retention, 'Organization task cleanup', '7 days')
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(retention.getByLabel('Organization log retention')).toHaveText('30 days')
  await expect(retention.getByLabel('Organization soft deletion cleanup')).toHaveText('90 days')
  await expect(retention.getByLabel('Organization task cleanup')).toHaveText('30 days')
  expect(
    captureConfiguredRetention(
      await getOrganizationRetention(context.request, ids.enterpriseOrganizationId)
    )
  ).toEqual(baseline)

  await selectLabeledOption(retention, 'Organization log retention', '7 days')
  await selectLabeledOption(retention, 'Organization soft deletion cleanup', '14 days')
  await selectLabeledOption(retention, 'Organization task cleanup', '60 days')
  const saveDefaultsResponsePromise = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/organizations/${encodeURIComponent(ids.enterpriseOrganizationId)}/data-retention`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const saveDefaultsResponse = await saveDefaultsResponsePromise
  expect(saveDefaultsResponse.status()).toBe(200)
  const savedDefaultsBody = saveDefaultsResponse.request().postDataJSON() as Record<string, unknown>
  expect(savedDefaultsBody).toEqual({
    ...SAVED_DEFAULTS,
    retentionOverrides: [],
  })
  expect(savedDefaultsBody).not.toHaveProperty('piiRedaction')
  expect(
    captureConfiguredRetention(
      await getOrganizationRetention(context.request, ids.enterpriseOrganizationId)
    )
  ).toEqual({
    ...baseline,
    ...SAVED_DEFAULTS,
  })

  retention = await expectDataRetentionReady(page)
  await page.getByRole('button', { name: 'Add override', exact: true }).click()
  await retention.getByRole('button', { name: 'Select workspaces', exact: true }).click()
  await page.getByRole('menuitem', { name: workspaceName, exact: true }).click()
  await page.keyboard.press('Escape')
  await selectLabeledOption(retention, 'Workspace override log retention', '3 days')
  await expect(retention.getByLabel('Workspace override soft deletion cleanup')).toHaveText(
    'Inherit from organization'
  )
  await expect(retention.getByLabel('Workspace override task cleanup')).toHaveText(
    'Inherit from organization'
  )

  const addOverrideResponsePromise = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/organizations/${encodeURIComponent(ids.enterpriseOrganizationId)}/data-retention`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const addOverrideResponse = await addOverrideResponsePromise
  expect(addOverrideResponse.status()).toBe(200)
  const addOverrideBody = addOverrideResponse.request().postDataJSON() as Record<string, unknown>
  expect(addOverrideBody).toEqual({
    ...SAVED_DEFAULTS,
    retentionOverrides: [
      {
        workspaceId: ids.enterpriseWorkspaceId,
        logRetentionHours: 3 * 24,
      },
    ],
  })
  expect(addOverrideBody).not.toHaveProperty('piiRedaction')
  expect(
    (await getOrganizationRetention(context.request, ids.enterpriseOrganizationId)).configured
      .retentionOverrides
  ).toEqual([
    {
      workspaceId: ids.enterpriseWorkspaceId,
      logRetentionHours: 3 * 24,
    },
  ])

  retention = await expectDataRetentionReady(page)
  const overrideRow = retention.getByRole('button', {
    name: `Edit retention policy for ${workspaceName}`,
  })
  await expect(overrideRow).toContainText('Log 3d · Soft-delete inherited · Task inherited')

  await page.goto(
    `/workspace/${encodeURIComponent(ids.enterpriseWorkspaceId)}/settings/data-retention`
  )
  retention = await expectDataRetentionReady(page)
  await expect(
    retention.getByRole('button', {
      name: `Edit retention policy for ${workspaceName}`,
    })
  ).toContainText('Log 3d · Soft-delete inherited · Task inherited')

  await retention
    .getByRole('button', { name: `Edit retention policy for ${workspaceName}` })
    .click()
  await page.getByRole('button', { name: 'Remove override', exact: true }).click()
  const removeConfirmation = page.getByRole('dialog', { name: 'Remove override' })
  const removeOverrideResponsePromise = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/organizations/${encodeURIComponent(ids.enterpriseOrganizationId)}/data-retention`
  )
  await removeConfirmation.getByRole('button', { name: 'Remove override', exact: true }).click()
  const removeOverrideResponse = await removeOverrideResponsePromise
  expect(removeOverrideResponse.status()).toBe(200)
  const removeOverrideBody = removeOverrideResponse.request().postDataJSON() as Record<
    string,
    unknown
  >
  expect(removeOverrideBody).toEqual({
    ...SAVED_DEFAULTS,
    retentionOverrides: [],
  })
  expect(removeOverrideBody).not.toHaveProperty('piiRedaction')

  retention = await expectDataRetentionReady(page)
  await retention.getByRole('button', { name: 'Edit organization retention policy' }).click()
  await selectLabeledOption(retention, 'Organization log retention', '30 days')
  await selectLabeledOption(retention, 'Organization soft deletion cleanup', '90 days')
  await selectLabeledOption(retention, 'Organization task cleanup', '30 days')
  const restoreResponsePromise = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/organizations/${encodeURIComponent(ids.enterpriseOrganizationId)}/data-retention`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const restoreResponse = await restoreResponsePromise
  expect(restoreResponse.status()).toBe(200)
  const restoreBody = restoreResponse.request().postDataJSON() as Record<string, unknown>
  expect(restoreBody).toEqual(buildRetentionPutBody(baseline))
  expect(restoreBody).not.toHaveProperty('piiRedaction')
  expect(
    captureConfiguredRetention(
      await getOrganizationRetention(context.request, ids.enterpriseOrganizationId)
    )
  ).toEqual(baseline)
})
