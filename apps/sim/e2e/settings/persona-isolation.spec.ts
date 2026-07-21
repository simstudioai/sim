import { expect, requirePersona, test } from '../fixtures/persona-test'

test.describe.configure({ mode: 'parallel' })

test('primary world cannot discover or access the isolation twin', async ({
  contextForPersona,
  personaManifest,
}) => {
  await assertWorldCannotSee(
    await contextForPersona('personalFreeOwner'),
    requirePersona(personaManifest, 'isolationTwinOwner').workspaces[0].workspaceId
  )
})

test('isolation twin cannot discover or access the primary world', async ({
  contextForPersona,
  personaManifest,
}) => {
  await assertWorldCannotSee(
    await contextForPersona('isolationTwinOwner'),
    requirePersona(personaManifest, 'personalFreeOwner').workspaces[0].workspaceId
  )
})

async function assertWorldCannotSee(
  context: import('@playwright/test').BrowserContext,
  foreignWorkspaceId: string
): Promise<void> {
  const listResponse = await context.request.get('/api/workspaces?scope=all')
  expect(listResponse.status()).toBe(200)
  const payload = (await listResponse.json()) as { workspaces?: Array<{ id: string }> }
  expect(payload.workspaces?.map(({ id }) => id)).not.toContain(foreignWorkspaceId)

  const response = await context.request.get(
    `/api/workspaces/${encodeURIComponent(foreignWorkspaceId)}/host-context`
  )
  expect(response.status()).toBe(403)
}
