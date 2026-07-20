import postgres from 'postgres'

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
    const pattern = `e2e-foundation-${runId}-%@example.com`
    const rows = await sql<Array<{ stripeCustomerId: string | null; hasStats: boolean }>>`
      SELECT
        u.stripe_customer_id AS "stripeCustomerId",
        (s.user_id IS NOT NULL) AS "hasStats"
      FROM "user" u
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE u.email LIKE ${pattern}
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
