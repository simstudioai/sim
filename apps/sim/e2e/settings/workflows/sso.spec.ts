import { rootCertificates } from 'node:tls'
import type { Response } from '@playwright/test'
import {
  deleteRunPrefixedSsoProviders,
  expectSsoReady,
  listSsoProviders,
  newPersonaPage,
  primaryWorldIds,
  uniqueSsoProviderId,
  waitForSameOriginResponse,
} from './helpers'
import { expect, test } from './workflow-test'

// SSO registration and verification responses can contain certificates and
// verification values. The workflow deliberately proves behavior without
// retaining Playwright's network-bearing trace artifact.
test.use({ trace: 'off' })

test('SAML provider lifecycle stays pending and uses scoped management APIs', async ({
  contextForPersona,
  personaManifest,
  registerCleanup,
}) => {
  const ids = primaryWorldIds(personaManifest)
  const { context, page } = await newPersonaPage(contextForPersona, 'enterpriseOrganizationAdmin')
  const { providerId, providerPrefix } = uniqueSsoProviderId(personaManifest)
  const domain = `${providerId}.example.com`
  const issuer = `https://issuer-${providerId}.invalid`
  const entryPoint = `https://login-${providerId}.invalid/saml`
  const updatedIssuer = `https://updated-${providerId}.invalid`

  registerCleanup('remove run-prefixed SSO providers', () =>
    deleteRunPrefixedSsoProviders(context.request, ids.enterpriseOrganizationId, providerPrefix)
  )
  await deleteRunPrefixedSsoProviders(context.request, ids.enterpriseOrganizationId, providerPrefix)

  await page.goto(`/organization/${encodeURIComponent(ids.enterpriseOrganizationId)}/settings/sso`)
  let sso = await expectSsoReady(page)
  await sso.getByLabel('Provider Type', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'SAML', exact: true }).click()
  await sso.getByLabel('Provider ID', { exact: true }).fill(providerId)
  await sso.getByLabel('Issuer URL', { exact: true }).click()
  await sso.getByLabel('Issuer URL', { exact: true }).fill(issuer)
  await sso.getByLabel('Domain', { exact: true }).click()
  await sso.getByLabel('Domain', { exact: true }).fill(domain)
  await sso.getByLabel('Entry Point URL', { exact: true }).fill(entryPoint)
  const publicCertificate = rootCertificates[0]
  if (!publicCertificate) throw new Error('Node did not expose a public root certificate')
  await sso
    .getByLabel('Identity Provider Certificate', { exact: true })
    .evaluate((element, certificate) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (!setter) throw new Error('Textarea value setter is unavailable')
      setter.call(element, certificate)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, publicCertificate)

  const createResponsePromise = waitForSameOriginResponse(page, 'POST', '/api/auth/sso/register')
  const createResponse = await (async () => {
    try {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      return await createResponsePromise
    } finally {
      const certificateInput = page.getByLabel('Identity Provider Certificate', { exact: true })
      if ((await certificateInput.count()) > 0) {
        await certificateInput.evaluate((element) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
          )?.set
          setter?.call(element, '')
        })
      }
    }
  })()
  expect(createResponse.status()).toBe(200)
  const createRequestBody = createResponse.request().postDataJSON() as Record<string, unknown>
  const { cert: createCertificate, ...createBody } = createRequestBody
  expect(Object.keys(createRequestBody).sort()).toEqual(
    [
      'cert',
      'domain',
      'entryPoint',
      'issuer',
      'mapping',
      'orgId',
      'providerId',
      'providerType',
      'wantAssertionsSigned',
    ].sort()
  )
  expect(createBody).toMatchObject({
    providerType: 'saml',
    providerId,
    orgId: ids.enterpriseOrganizationId,
    issuer,
    domain,
    entryPoint,
    wantAssertionsSigned: true,
  })
  expect(typeof createCertificate).toBe('string')

  sso = await expectSsoReady(page)
  await expect(sso.getByLabel('SSO provider status')).toHaveText('Pending verification')
  const created = (await listSsoProviders(context.request, ids.enterpriseOrganizationId)).find(
    (provider) => provider.providerId === providerId
  )
  expect(created).toMatchObject({
    providerId,
    providerType: 'saml',
    domain,
    issuer,
    domainVerified: false,
    organizationId: ids.enterpriseOrganizationId,
  })
  if (!created?.id) throw new Error('Created SSO provider row was not recoverable')

  try {
    const expectedInstructionsPath = `/api/auth/sso/providers/${encodeURIComponent(created.id)}/domain-verification/request`
    const instructionsResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        response.request().method() === 'POST' &&
        url.origin === new URL(page.url()).origin &&
        url.pathname.endsWith('/domain-verification/request')
      )
    })
    await sso.getByRole('button', { name: 'Show DNS instructions', exact: true }).click()
    const instructionsResponse = await instructionsResponsePromise
    expect(new URL(instructionsResponse.url()).pathname).toBe(expectedInstructionsPath)
    expect(instructionsResponse.status()).toBe(201)
    await expect(sso.getByLabel('DNS verification instructions')).toBeVisible()
    await expect(
      sso.getByText('Add a TXT record with this name and value:', { exact: true })
    ).toBeVisible()
  } finally {
    const instructions = page.getByLabel('DNS verification instructions')
    if ((await instructions.count()) > 0) {
      await instructions.evaluate((element) => element.remove())
    }
    await page.reload()
  }

  sso = await expectSsoReady(page)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(sso.getByLabel('Provider Type', { exact: true })).toBeDisabled()
  await expect(sso.getByLabel('Provider ID', { exact: true })).toBeDisabled()
  await sso.getByLabel('Issuer URL', { exact: true }).click()
  await sso.getByLabel('Issuer URL', { exact: true }).fill(updatedIssuer)
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(sso.getByText(issuer, { exact: true })).toBeVisible()
  expect(
    (await listSsoProviders(context.request, ids.enterpriseOrganizationId)).find(
      (provider) => provider.id === created.id
    )?.issuer
  ).toBe(issuer)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await sso.getByLabel('Issuer URL', { exact: true }).click()
  await sso.getByLabel('Issuer URL', { exact: true }).fill(updatedIssuer)
  const updateResponsePromise = waitForSameOriginResponse(
    page,
    'PATCH',
    `/api/auth/sso/providers/${encodeURIComponent(created.id)}`
  )
  let updateResponse: Response | undefined
  try {
    await page.getByRole('button', { name: 'Update', exact: true }).click()
    updateResponse = await updateResponsePromise
  } finally {
    const certificateInput = page.getByLabel('Identity Provider Certificate', { exact: true })
    if ((await certificateInput.count()) > 0) {
      await certificateInput.evaluate((element) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(element, '')
      })
    }
  }
  if (!updateResponse) throw new Error('SSO update response was not observed')
  expect(updateResponse.status()).toBe(200)
  const updateRequestBody = updateResponse.request().postDataJSON() as Record<string, unknown>
  const { cert: updateCertificate, ...updateBody } = updateRequestBody
  expect(typeof updateCertificate).toBe('string')
  expect(updateBody).toMatchObject({
    issuer: updatedIssuer,
    domain,
    entryPoint,
    wantAssertionsSigned: true,
  })
  expect(updateBody).not.toHaveProperty('providerId')
  expect(updateBody).not.toHaveProperty('providerType')
  expect(updateBody).not.toHaveProperty('orgId')
  await expect((await expectSsoReady(page)).getByText(updatedIssuer, { exact: true })).toBeVisible()
  expect(
    (await listSsoProviders(context.request, ids.enterpriseOrganizationId)).find(
      (provider) => provider.id === created.id
    )?.issuer
  ).toBe(updatedIssuer)

  sso = await expectSsoReady(page)
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Remove SSO provider' })
  const deleteResponsePromise = waitForSameOriginResponse(
    page,
    'DELETE',
    `/api/auth/sso/providers/${encodeURIComponent(created.id)}`
  )
  await confirmation.getByRole('button', { name: 'Remove provider', exact: true }).click()
  expect((await deleteResponsePromise).status()).toBe(200)
  expect(
    (await listSsoProviders(context.request, ids.enterpriseOrganizationId)).some(
      (provider) => provider.id === created.id
    )
  ).toBe(false)
})
