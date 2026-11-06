import { generateId } from '@sim/utils/id'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import type { CreateDataDrainBody, DataDrain, DataDrainRun } from '@/platform/lib/data/data-drains'

const SNAPSHOT = '2026-10-13T11:24:00.000Z'
interface DrainInventory {
  drains: DataDrain[]
  runs: DataDrainRun[]
}

const inventories = new WeakMap<SettingsFixtureState, DrainInventory>()

function drainRecord(
  id: string,
  body: CreateDataDrainBody,
  state: SettingsFixtureState,
  createdAt: string
): DataDrain {
  const { destinationCredentials, ...fields } = body
  return {
    ...fields,
    id,
    organizationId: state.organizationId,
    createdBy: state.general.profile.id,
    enabled: body.enabled ?? true,
    createdAt,
    updatedAt: createdAt,
    cursor: null,
    lastRunAt: null,
    lastSuccessAt: null,
  }
}

function runRecord(
  drainId: string,
  date: string,
  trigger: DataDrainRun['trigger'],
  failed = false
): DataDrainRun {
  return {
    id: generateId(),
    drainId,
    trigger,
    status: failed ? 'failed' : 'success',
    startedAt: date,
    finishedAt: date,
    rowsExported: failed ? 0 : 36,
    bytesWritten: failed ? 0 : 6144,
    cursorBefore: null,
    cursorAfter: failed ? null : date,
    error: failed ? 'Destination rejected the request.' : null,
    locators: [],
  }
}

function inventory(state: SettingsFixtureState): DrainInventory {
  const existing = inventories.get(state)
  if (existing) return existing
  const examples = [
    {
      name: 'Workflow log archive',
      source: 'workflow_logs',
      scheduleCadence: 'daily',
      destinationType: 's3',
      destinationConfig: { bucket: 'sim-workflow-archive', region: 'us-east-1' },
    },
    {
      name: 'Audit events',
      source: 'audit_logs',
      scheduleCadence: 'hourly',
      destinationType: 'datadog',
      destinationConfig: { site: 'us1', service: 'sim' },
      enabled: false,
    },
  ] as const satisfies readonly CreateDataDrainBody[]
  const count = state.scenario === 'empty' ? 0 : state.scenario === 'stress' ? 36 : examples.length
  const drains = Array.from({ length: count }, (_, index) => {
    const body = examples[index % examples.length]
    const drain = drainRecord(`export-${index + 1}`, body, state, SNAPSHOT)
    if (index >= examples.length) drain.name += ` · Region ${index + 1}`
    drain.lastRunAt = SNAPSHOT
    if (index % 2 === 0) drain.lastSuccessAt = SNAPSHOT
    return drain
  })
  const result = {
    drains,
    runs: drains.map((drain, index) => runRecord(drain.id, SNAPSHOT, 'cron', index % 2 === 1)),
  }
  inventories.set(state, result)
  return result
}

/** All destinations and runs belong to the current fixture session; only public config survives creation. */
export async function drainsFixture(request: Request, path: string, state: SettingsFixtureState) {
  const base = `/api/organizations/${state.organizationId}/data-drains`
  if (path !== base && !path.startsWith(`${base}/`)) return
  const data = inventory(state)
  const [id, action] = path.slice(base.length + 1).split('/')
  if (!id) {
    if (request.method === 'GET') return { drains: data.drains }
    if (request.method === 'POST') {
      const drain = drainRecord(generateId(), await request.json(), state, new Date().toISOString())
      data.drains.unshift(drain)
      return { drain }
    }
    return
  }
  const drain = data.drains.find((item) => item.id === id)
  if (!drain) return
  if (action === 'runs' && request.method === 'GET') {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50)
    return { runs: data.runs.filter((run) => run.drainId === id).slice(0, limit) }
  }
  if (action === 'run' && request.method === 'POST' && drain.enabled) {
    const date = new Date().toISOString()
    const run = runRecord(id, date, 'manual')
    data.runs.unshift(run)
    drain.lastRunAt = date
    drain.lastSuccessAt = date
    return { jobId: run.id }
  }
  if (action === 'test' && request.method === 'POST') return { ok: true }
  if (action) return
  if (request.method === 'GET') return { drain }
  if (request.method === 'PUT') {
    const { enabled } = await request.json()
    if (typeof enabled === 'boolean') drain.enabled = enabled
    drain.updatedAt = new Date().toISOString()
    return { drain }
  }
  if (request.method === 'DELETE') {
    data.drains = data.drains.filter((item) => item.id !== id)
    data.runs = data.runs.filter((run) => run.drainId !== id)
    return { success: true }
  }
}
