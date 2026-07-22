import postgres from 'postgres'
import { readScenarioManifest } from '../fixtures/e2e-world'
import { assertSettingsPrimaryRetentionBaseline } from './data-retention'

export async function assertAdminApiBoundary(origin: string, adminKey: string): Promise<void> {
  const endpoint = `${origin}/api/v1/admin/users?limit=1&offset=0`
  const unauthorized = await fetch(endpoint)
  if (unauthorized.status !== 401) {
    throw new Error(`Admin API missing-key probe returned ${unauthorized.status}, expected 401`)
  }

  const authorized = await fetch(endpoint, {
    headers: { 'x-admin-key': adminKey },
  })
  if (!authorized.ok) {
    throw new Error(`Configured Admin API probe returned ${authorized.status}`)
  }
}

export interface FoundationProvisioningResult {
  count: number
  allHaveStripeCustomers: boolean
  allHaveStats: boolean
}

export async function inspectFoundationUsers(
  databaseUrl: string,
  runId: string
): Promise<FoundationProvisioningResult> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 })
  try {
    const prefix = `e2e-foundation-${runId}-`
    const rows = await sql<Array<{ stripeCustomerId: string | null; hasStats: boolean }>>`
      SELECT
        u.stripe_customer_id AS "stripeCustomerId",
        (s.user_id IS NOT NULL) AS "hasStats"
      FROM "user" u
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE starts_with(u.email, ${prefix})
    `
    return {
      count: rows.length,
      allHaveStripeCustomers: rows.every((row) => row.stripeCustomerId?.startsWith('cus_e2e_')),
      allHaveStats: rows.every((row) => row.hasStats),
    }
  } finally {
    await sql.end()
  }
}

export async function assertManifestWorkspaceIdentities(
  databaseUrl: string,
  manifestPath: string
): Promise<void> {
  const manifest = readScenarioManifest(manifestPath)
  const expected = Object.values(manifest.worlds).flatMap((world) =>
    Object.values(world.workspaceIdentities)
  )
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 })
  try {
    const ids = expected.map(({ id }) => id)
    const rows =
      ids.length === 0
        ? []
        : await sql<Array<{ id: string; name: string }>>`
            SELECT id, name
            FROM workspace
            WHERE id = ANY(${ids})
          `
    const actualById = new Map(rows.map((row) => [row.id, row.name]))
    for (const workspace of expected) {
      if (actualById.get(workspace.id) !== workspace.name) {
        throw new Error(`Manifest workspace changed or disappeared: ${workspace.id}`)
      }
    }
    if (rows.length !== expected.length) {
      throw new Error('Manifest workspace inventory contains unexpected duplicates')
    }
  } finally {
    await sql.end()
  }
}

export async function assertSettingsPrimaryRetentionRestored(
  databaseUrl: string,
  manifestPath: string
): Promise<void> {
  const manifest = readScenarioManifest(manifestPath)
  const organizationId =
    manifest.worlds['settings-primary']?.organizationIds['enterprise-organization']
  if (!organizationId) {
    throw new Error('Settings-primary Enterprise organization is missing from the manifest')
  }

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 })
  try {
    const [row] = await sql<Array<{ dataRetentionSettings: unknown }>>`
      SELECT data_retention_settings AS "dataRetentionSettings"
      FROM organization
      WHERE id = ${organizationId}
      LIMIT 1
    `
    assertSettingsPrimaryRetentionBaseline(
      row?.dataRetentionSettings,
      'Post-Playwright settings-primary retention probe'
    )
  } finally {
    await sql.end()
  }
}
