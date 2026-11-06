import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import {
  getAccessRequestTargetKey,
  type RequestRecord,
  type RequestTarget,
} from '@/platform/lib/data/requests'

const CATALOG = [
  {
    label: 'Workspace Creation',
    target: { kind: 'feature', configKey: 'disableWorkspaceCreation' },
  },
  { label: 'Member Directory', target: { kind: 'feature', configKey: 'hideOrgMemberDirectory' } },
  { label: 'Member usage limit', target: { kind: 'usage_limit', id: 'member' } },
] as const satisfies readonly { label: string; target: RequestTarget }[]

function newRequest(
  state: SettingsFixtureState,
  item: (typeof CATALOG)[number],
  requester: RequestRecord['requester'],
  reason: string
): RequestRecord {
  return {
    id: generateId(),
    organizationId: state.organizationId,
    workspaceId: null,
    target: item.target,
    targetLabel: item.label,
    reason,
    status: 'pending',
    decisionReason: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    groupName: item.target.kind === 'feature' ? 'Organization default' : null,
    requester: { id: requester.id, name: requester.name, email: requester.email },
  }
}

function setup(state: SettingsFixtureState) {
  const rows: RequestRecord[] = []
  if (state.scenario !== 'empty') {
    const profile = state.general.profile
    const jo = { id: 'jo', name: 'Jo Bell', email: 'jo@example.test' }
    for (const [index, item] of CATALOG.entries())
      rows.push(
        newRequest(
          state,
          item,
          index === 1 ? profile : jo,
          [
            'Create a workspace for the new project.',
            'Find teammates for a review.',
            'Run the remaining evaluations this month.',
          ][index]
        )
      )
    if (state.scenario === 'stress')
      for (let i = 0; i < 55; i++) {
        const row = newRequest(
          state,
          CATALOG[i % CATALOG.length],
          profile,
          'Access for a customer operations review.'
        )
        rows.push({
          ...row,
          status: i % 2 ? 'declined' : 'cancelled',
          decidedAt: row.createdAt,
          decisionReason: i % 2 ? 'The previous project has ended.' : null,
        })
      }
  }
  return { rows, allowed: true, limits: new Map<string, number>() }
}

const sessions = new WeakMap<SettingsFixtureState, ReturnType<typeof setup>>()
const personalPath = '/api/access-requests'

function page<T>(items: T[], params: URLSearchParams) {
  const offset = Number(params.get('offset') ?? 0)
  const end = offset + Number(params.get('limit') ?? 50)
  return { items: items.slice(offset, end), total: items.length, hasMore: end < items.length }
}

export async function requestsFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
): Promise<unknown> {
  const reviewPath = `/api/organizations/${state.organizationId}/access-requests`
  if (
    ![personalPath, reviewPath].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  )
    return
  const session = sessions.get(state) ?? setup(state)
  sessions.set(state, session)
  const mine = session.rows.filter((row) => row.requester.id === state.general.profile.id)
  const params = new URL(request.url).searchParams
  const search = (params.get('search') ?? '').trim().toLowerCase()
  if (path === `${reviewPath}/settings`) {
    if (request.method === 'PATCH')
      session.allowed = toRecord(await request.json()).allowRequests === true
    return { allowRequests: session.allowed }
  }
  if (path === `${personalPath}/discovery`) {
    const catalog = state.scenario === 'empty' ? [] : CATALOG
    const entries = catalog.flatMap((item) => {
      const key = getAccessRequestTargetKey(item.target)
      const history = session.rows.filter((row) => getAccessRequestTargetKey(row.target) === key)
      const available =
        item.target.kind === 'feature' && history.some((row) => row.status === 'fulfilled')
      const status = available ? 'allowed' : 'requestable'
      if (
        (params.has('targetKey') && params.get('targetKey') !== key) ||
        (params.has('targetKind') && params.get('targetKind') !== item.target.kind) ||
        (params.has('state') && params.get('state') !== status) ||
        !item.label.toLowerCase().includes(search)
      )
        return []
      const pending = history.find(
        (row) => row.requester.id === state.general.profile.id && row.status === 'pending'
      )
      return [
        {
          ...item,
          state: status,
          reason: available
            ? null
            : item.target.kind === 'feature'
              ? 'Restricted by your permission group.'
              : 'An organization administrator set your member credit limit.',
          pendingRequestId: pending?.id ?? null,
        },
      ]
    })
    const slice = page(entries, params)
    return {
      enabled: session.allowed,
      organizationId: state.organizationId,
      entries: slice.items,
      total: slice.total,
      hasMore: slice.hasMore,
    }
  }
  if (path === personalPath || path === reviewPath) {
    if (request.method === 'POST' && path === personalPath) {
      const body = toRecord(await request.json())
      const target = toRecord(body.target)
      const item = CATALOG.find(
        (item) =>
          item.target.kind === target.kind &&
          ('configKey' in item.target
            ? item.target.configKey === target.configKey
            : item.target.id === target.id)
      )
      if (!item || !session.allowed) return
      const row = newRequest(state, item, state.general.profile, String(body.reason ?? ''))
      session.rows.unshift(row)
      return { request: row }
    }
    const slice = page(
      (path === personalPath ? mine : session.rows).filter(
        (row) =>
          (!params.has('requestId') || params.get('requestId') === row.id) &&
          (!params.has('status') || params.get('status') === row.status) &&
          [row.targetLabel, row.reason, row.requester.email, row.requester.name].some((value) =>
            value?.toLowerCase().includes(search)
          )
      ),
      params
    )
    return { requests: slice.items, total: slice.total, hasMore: slice.hasMore }
  }
  const [, id, action] = path
    .slice((path.startsWith(personalPath) ? personalPath : reviewPath).length)
    .split('/')
  const row = (path.startsWith(personalPath) ? mine : session.rows).find((item) => item.id === id)
  if (!row) return
  const usage = row.target.kind === 'usage_limit'
  if (action === 'preview')
    return {
      request: row,
      resolutionKind: usage ? 'usage_limit' : 'permission',
      group: usage ? null : { id: 'default', name: row.groupName },
      canApply: row.status === 'pending' && session.allowed,
      unavailableReason: session.allowed ? null : 'New requests and approvals are paused.',
      fingerprint: row.id,
      currentLimitCredits: usage ? 200 : null,
      newLimitCredits: session.limits.get(row.id) ?? null,
      changes:
        row.target.kind === 'feature'
          ? [
              {
                configKey: row.target.configKey,
                label: row.targetLabel,
                before: true,
                after: false,
              },
            ]
          : [],
      impact: {
        memberCount: usage ? 1 : 3,
        workspaceCount: 0,
        workspaceNames: [],
        truncated: false,
      },
    }
  if (row.status !== 'pending') return { request: row }
  if (action === 'cancel') row.status = 'cancelled'
  else if (action === 'resolve') {
    const body = toRecord(await request.json())
    if (body.action === 'apply' && !session.allowed) return
    row.status = body.action === 'decline' ? 'declined' : 'fulfilled'
    if (row.status === 'declined') row.decisionReason = String(body.reason)
    if (usage && typeof body.newLimitCredits === 'number')
      session.limits.set(row.id, body.newLimitCredits)
  } else return
  row.decidedAt = new Date().toISOString()
  return { request: row }
}
