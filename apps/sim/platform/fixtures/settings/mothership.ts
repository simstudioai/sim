import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import type { LicenseDraft, MothershipEnv } from '@/platform/lib/data/mothership-admin'

interface LicenseRow {
  id: string
  name: string
  count: number
  expiration_date: string | null
  created_at: string
}

function environmentLicenses(state: SettingsFixtureState, env: string) {
  const key = `mothership/licenses/${env}`
  const existing = state.records.get(key) as LicenseRow[] | undefined
  if (existing) return existing
  const records = [
    {
      id: `license-${env}-1`,
      name: env === 'prod' ? 'Northstar Logistics' : 'Operations sandbox',
      count: env === 'prod' ? 24 : 3,
      expiration_date: null,
      created_at: new Date(state.referenceTime - 30 * 86400000).toISOString(),
    },
  ]
  state.records.set(key, records)
  return records
}

export function generateSampleLicense(
  state: SettingsFixtureState,
  env: MothershipEnv,
  draft: LicenseDraft
) {
  if (state.scenario !== 'stress' || !draft.name.trim() || !draft.approvalReference.trim())
    throw new Error('An enterprise name and approval reference are required.')
  const licenses = environmentLicenses(state, env)
  const id = generateId()
  licenses.unshift({
    id,
    name: draft.name.trim(),
    count: 0,
    expiration_date: draft.expirationDate,
    created_at: new Date(state.referenceTime).toISOString(),
  })
  return `SAMPLE-ONLY-${id}`
}

export async function mothershipFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
) {
  if (path !== '/api/admin/mothership') return
  if (state.scenario !== 'stress') return Response.json({ error: 'Access denied' }, { status: 403 })
  const params = new URL(request.url).searchParams
  const env = params.get('env') ?? 'dev'
  const endpoint = params.get('endpoint')
  if (request.method === 'GET' && endpoint === 'licenses')
    return { licenses: environmentLicenses(state, env) }
  if (request.method !== 'POST' || (endpoint !== 'requests' && endpoint !== 'user-breakdown'))
    return Response.json({ error: 'Unknown operation' }, { status: 404 })
  const body = toRecord(await request.json())
  const start = Date.parse(String(body.start))
  const end = Date.parse(String(body.end))
  const count = env === 'prod' ? 150 : env === 'staging' ? 58 : 32
  const users = ['ops-analyst', 'research-team', 'data-eng']
  const records = Array.from({ length: count }, (_, index) => {
    const time = state.referenceTime - 60000 - index * 5400000
    return {
      user_id: users[index % users.length],
      request_id: `req-${env}-${2048 - index}`,
      model: index % 4 === 0 ? 'claude-opus-4' : 'claude-sonnet-4',
      created_at: new Date(time).toISOString(),
      duration_ms: 620 + 417 * (index % 12),
      billed_total_cost: (12 + (index % 29)) / 10000,
      tool_call_count: index % 5,
      error: index % 12 === 3,
      aborted: index % 19 === 5,
      time,
    }
  }).filter((row) => row.time >= start && row.time <= end)
  if (endpoint === 'requests') return { count: records.length, requests: records.slice(0, 100) }
  const breakdown = users.flatMap((user) => {
    const rows = records.filter((row) => row.user_id === user)
    return rows.length
      ? [
          {
            user_id: user,
            request_count: rows.length,
            total_cost: rows.reduce((sum, row) => sum + row.billed_total_cost, 0),
            last_request: rows[0].created_at,
          },
        ]
      : []
  })
  return { total_requests: records.length, total_users: breakdown.length, users: breakdown }
}
