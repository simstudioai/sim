import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import type { EnterpriseAuditLogEntry } from '@/platform/lib/data/audit-logs'
import { csvRow } from '@/platform/lib/data/csv'

const HOUR = 3_600_000

function auditEntries(state: SettingsFixtureState): EnterpriseAuditLogEntry[] {
  const count = state.scenario === 'empty' ? 0 : state.scenario === 'stress' ? 265 : 72
  const [operations, finance] = settingsWorkspaces
  const events = [
    {
      action: 'workspace.updated',
      workspaceId: operations.id,
      resourceType: 'workspace',
      resourceId: operations.id,
      resourceName: operations.name,
      description: 'Updated customer operations workspace settings',
      metadata: { changes: { name: { before: 'Operations', after: operations.name } } },
    },
    {
      action: 'workflow.deployed',
      workspaceId: finance.id,
      resourceType: 'workflow',
      resourceId: 'forecast-workflow',
      resourceName: 'Quarterly forecast',
      description: 'Deployed the quarterly forecast workflow',
      metadata: { deploymentMethod: 'manual', triggers: ['schedule', 'api'] },
    },
    {
      action: 'api_key.revoked',
      workspaceId: operations.id,
      resourceType: 'api_key',
      resourceId: 'analytics-api-key',
      resourceName: 'Analytics export',
      description: 'Revoked the analytics export API key',
      metadata: { reason: 'Key rotation' },
    },
    {
      action: 'org_member.role_changed',
      workspaceId: null,
      resourceType: 'organization',
      resourceId: state.organizationId,
      resourceName: 'Sim',
      description: 'Changed a member’s organization role',
      metadata: { member: 'Jo Bell', previousRole: 'member', newRole: 'admin' },
    },
    {
      action: 'workflow.updated',
      workspaceId: operations.id,
      resourceType: 'workflow',
      resourceId: 'review-workflow',
      resourceName: 'Customer operations review',
      description: 'Updated the customer operations review workflow',
      metadata: { changedFields: ['inputs', 'schedule'], published: false },
    },
  ]
  return Array.from({ length: count }, (_, index) => {
    const event = events[index % events.length]
    const actor =
      index % 3 === 1
        ? { id: 'mina', name: 'Mina Kim', email: 'mina@example.test' }
        : state.general.profile
    return {
      ...event,
      id: `audit-${index + 1}`,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      createdAt: new Date(state.referenceTime - index * 3 * HOUR).toISOString(),
    }
  })
}

function auditCsv(entries: EnterpriseAuditLogEntry[]) {
  const header = [
    'Date',
    'Action',
    'Resource Type',
    'Resource Name',
    'Actor',
    'Description',
    'Event ID',
    'Workspace ID',
    'Resource ID',
    'Actor ID',
    'IP Address',
    'User Agent',
    'Surface',
    'Metadata',
  ]
  const rows = entries.map((entry) =>
    csvRow([
      entry.createdAt,
      entry.action,
      entry.resourceType,
      entry.resourceName,
      entry.actorEmail || entry.actorName || 'System',
      entry.description,
      entry.id,
      entry.workspaceId,
      entry.resourceId,
      entry.actorId,
      null,
      null,
      'web',
      entry.metadata,
    ])
  )
  return new Response([csvRow(header), ...rows].join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-Export-Truncated': '0' },
  })
}

export function auditFixture(request: Request, path: string, state: SettingsFixtureState) {
  if (path !== '/api/audit-logs' && path !== '/api/audit-logs/export') return
  const params = new URL(request.url).searchParams
  if (request.method !== 'GET') return new Response(null, { status: 405 })
  if (params.get('organizationId') !== state.organizationId)
    return new Response(null, { status: 403 })
  const workspaceId = params.get('workspaceId')
  if (workspaceId && !settingsWorkspaces.some((workspace) => workspace.id === workspaceId))
    return Response.json(
      { error: 'Workspace does not belong to this organization' },
      { status: 400 }
    )
  const types = (params.get('resourceType') ?? '')
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean)
  const start = Date.parse(params.get('startDate') ?? '')
  const end = Date.parse(params.get('endDate') ?? '')
  const search = params.get('search')?.trim().toLowerCase()
  const entries = auditEntries(state).filter((entry) => {
    const createdAt = Date.parse(entry.createdAt)
    if (createdAt < start || createdAt > end) return false
    if (workspaceId && workspaceId !== entry.workspaceId) return false
    if (types.length && !types.includes(entry.resourceType)) return false
    return (
      !search ||
      [entry.action, entry.description, entry.resourceName, entry.actorName, entry.actorEmail].some(
        (value) => value?.toLowerCase().includes(search)
      )
    )
  })
  if (path === '/api/audit-logs/export') return auditCsv(entries)
  const cursor = params.get('cursor')
  const startIndex = cursor ? entries.findIndex((entry) => entry.id === cursor) + 1 : 0
  if (cursor && !startIndex) return Response.json({ error: 'Invalid cursor' }, { status: 400 })
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 100)
  const data = entries.slice(startIndex, startIndex + limit)
  const nextCursor = startIndex + data.length < entries.length ? data.at(-1)?.id : undefined
  return { success: true, data, nextCursor }
}
