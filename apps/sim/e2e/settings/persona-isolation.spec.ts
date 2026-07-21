import { expect, requirePersona, test } from '../fixtures/persona-test'

test.describe.configure({ mode: 'parallel' })

test('primary world cannot discover or access the isolation twin', async ({
  contextForPersona,
  personaManifest,
}) => {
  const ownPersona = requirePersona(personaManifest, 'personalFreeOwner')
  await assertWorldCannotSee(
    await contextForPersona('personalFreeOwner'),
    ownPersona,
    requirePersona(personaManifest, 'isolationTwinOwner').workspaces[0].workspaceId
  )
})

test('isolation twin cannot discover or access the primary world', async ({
  contextForPersona,
  personaManifest,
}) => {
  const ownPersona = requirePersona(personaManifest, 'isolationTwinOwner')
  await assertWorldCannotSee(
    await contextForPersona('isolationTwinOwner'),
    ownPersona,
    requirePersona(personaManifest, 'personalFreeOwner').workspaces[0].workspaceId
  )
})

async function assertWorldCannotSee(
  context: import('@playwright/test').BrowserContext,
  ownPersona: import('../fixtures/e2e-world').PersonaManifestEntry,
  foreignWorkspaceId: string
): Promise<void> {
  const page = await context.newPage()
  const canonicalUrl = new URL(ownPersona.canonicalRoute, requiredEnv('E2E_BASE_URL')).toString()
  await page.goto(canonicalUrl)
  await expect(page).toHaveURL(canonicalUrl)
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible()

  const sessionResponse = await context.request.get('/api/auth/get-session')
  expect(sessionResponse.status()).toBe(200)
  const session = (await sessionResponse.json()) as { user?: { id?: string; email?: string } }
  expect(session.user).toMatchObject({ id: ownPersona.userId, email: ownPersona.email })

  const listResponse = await context.request.get('/api/workspaces?scope=all')
  expect(listResponse.status()).toBe(200)
  const payload = (await listResponse.json()) as { workspaces?: Array<{ id: string }> }
  const listedWorkspaceIds = payload.workspaces?.map(({ id }) => id)
  expect(listedWorkspaceIds).toContain(ownPersona.workspaces[0].workspaceId)
  expect(listedWorkspaceIds).not.toContain(foreignWorkspaceId)

  const ownHostContext = await context.request.get(
    `/api/workspaces/${encodeURIComponent(ownPersona.workspaces[0].workspaceId)}/host-context`
  )
  expect(ownHostContext.status()).toBe(200)

  const response = await context.request.get(
    `/api/workspaces/${encodeURIComponent(foreignWorkspaceId)}/host-context`
  )
  expect(response.status()).toBe(403)

  const patchResponse = await context.request.patch(
    `/api/workspaces/${encodeURIComponent(foreignWorkspaceId)}`,
    {
      data: { name: 'E Two E Foreign Mutation Must Fail' },
    }
  )
  expect([403, 404]).toContain(patchResponse.status())
}

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing persona isolation environment value: ${key}`)
  return value
}
