/**
 * @vitest-environment node
 *
 * Every tool covered here calls an `/v2` endpoint, so it must read the v2 schema.
 * Verified against https://api.incident.io/v1/openapiV3.json:
 *
 * - `IncidentV2` has `permalink`; there is no `incident_url` on any schema in the spec.
 * - `ActionV2` has no `due_at` and no `external_issue_reference` (only `ActionV1` carries the
 *   latter — `FollowUpV2` genuinely has it, so the follow-up tools are untouched).
 * - `CustomFieldV2` has no `options` (only `CustomFieldV1` does).
 * - `UsersListResultV2.pagination_meta` is `PaginationMetaResultV2` — `{after, page_size}` — so
 *   `total_record_count` is v1/`...WithTotal` only. `IncidentsListResultV2` DOES use
 *   `PaginationMetaResultWithTotalV2`, so incidents_list keeps it.
 */
import { describe, expect, it } from 'vitest'
import { actionsListTool } from '@/tools/incidentio/actions_list'
import { actionsShowTool } from '@/tools/incidentio/actions_show'
import { customFieldsListTool } from '@/tools/incidentio/custom_fields_list'
import { customFieldsShowTool } from '@/tools/incidentio/custom_fields_show'
import { incidentsCreateTool } from '@/tools/incidentio/incidents_create'
import { incidentsListTool } from '@/tools/incidentio/incidents_list'
import { incidentsShowTool } from '@/tools/incidentio/incidents_show'
import { incidentsUpdateTool } from '@/tools/incidentio/incidents_update'
import { usersListTool } from '@/tools/incidentio/users_list'
import type { ToolConfig } from '@/tools/types'

const PERMALINK = 'https://app.incident.io/incidents/123'

/** A v2 incident as the API actually returns it — `permalink`, never `incident_url`. */
const INCIDENT_V2 = {
  id: '01FDAG4SAP5TYPT98WGR2N7W91',
  name: 'Our database is sad',
  summary: 'Sad database',
  mode: 'standard',
  call_url: 'https://zoom.us/foo',
  permalink: PERMALINK,
  reference: 'INC-123',
  created_at: '2021-08-17T13:28:57.801578Z',
  updated_at: '2021-08-17T13:28:57.801578Z',
  slack_channel_id: 'C02AW36C1M5',
  slack_channel_name: 'inc-165-green-parrot',
  visibility: 'public',
}

/** A v2 action as the API actually returns it — no `due_at`, no `external_issue_reference`. */
const ACTION_V2 = {
  id: '01FCNDV6P870EA6S7TK1DSYDG0',
  description: 'Call the fire brigade',
  status: 'outstanding',
  created_at: '2021-08-17T13:28:57.801578Z',
  updated_at: '2021-08-17T13:28:57.801578Z',
  completed_at: '2021-08-17T13:28:57.801578Z',
  incident_id: '01FDAG4SAP5TYPT98WGR2N7W91',
  assignee: { id: 'u1', name: 'Lisa', email: 'lisa@incident.io' },
  creator: { id: 'u2', name: 'Martha', email: 'martha@incident.io' },
}

const CUSTOM_FIELD_V2 = {
  id: '01FCNDV6P870EA6S7TK1DSYDG0',
  name: 'Affected Team',
  description: 'Which team is impacted',
  field_type: 'single_select',
  created_at: '2021-08-17T13:28:57.801578Z',
  updated_at: '2021-08-17T13:28:57.801578Z',
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function runTransform(tool: ToolConfig<any, any>, body: unknown): Promise<any> {
  const result = await tool.transformResponse!(jsonResponse(body), {} as never)
  return result.output
}

/** Recursively collects every key name present anywhere in the output tree. */
function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key)
      collectKeys(child, into)
    }
  }
  return into
}

/** Collects every property name declared anywhere in a tool's `outputs` tree. */
function collectDeclaredProperties(node: unknown, into = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return into
  const record = node as Record<string, unknown>
  if (record.properties && typeof record.properties === 'object') {
    for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
      into.add(key)
      collectDeclaredProperties(child, into)
    }
  }
  if (record.items) collectDeclaredProperties(record.items, into)
  return into
}

function declaredProperties(tool: ToolConfig<any, any>): Set<string> {
  const into = new Set<string>()
  for (const [key, output] of Object.entries(tool.outputs ?? {})) {
    into.add(key)
    collectDeclaredProperties(output, into)
  }
  return into
}

describe('incident.io incident tools surface the real v2 link field', () => {
  const cases: Array<[string, ToolConfig<any, any>, unknown, (out: any) => any]> = [
    ['incidents_list', incidentsListTool, { incidents: [INCIDENT_V2] }, (o) => o.incidents[0]],
    ['incidents_show', incidentsShowTool, { incident: INCIDENT_V2 }, (o) => o.incident],
    ['incidents_create', incidentsCreateTool, { incident: INCIDENT_V2 }, (o) => o.incident],
    ['incidents_update', incidentsUpdateTool, { incident: INCIDENT_V2 }, (o) => o.incident],
  ]

  for (const [name, tool, body, pick] of cases) {
    it(`${name} populates incident_url and permalink from the v2 permalink`, async () => {
      const incident = pick(await runTransform(tool, body))

      expect(incident.permalink).toBe(PERMALINK)
      expect(incident.incident_url).toBe(PERMALINK)
    })

    it(`${name} declares permalink alongside the incident_url alias`, () => {
      const declared = declaredProperties(tool)
      expect(declared.has('permalink')).toBe(true)
      expect(declared.has('incident_url')).toBe(true)
    })
  }
})

describe('incident.io v2 tools do not emit v1-only fields', () => {
  it('actions_list drops due_at and external_issue_reference', async () => {
    const output = await runTransform(actionsListTool, { actions: [ACTION_V2] })
    const keys = collectKeys(output)

    expect(keys.has('due_at')).toBe(false)
    expect(keys.has('external_issue_reference')).toBe(false)
    expect(declaredProperties(actionsListTool).has('due_at')).toBe(false)
    expect(declaredProperties(actionsListTool).has('external_issue_reference')).toBe(false)
  })

  it('actions_show drops due_at and external_issue_reference', async () => {
    const output = await runTransform(actionsShowTool, { action: ACTION_V2 })
    const keys = collectKeys(output)

    expect(keys.has('due_at')).toBe(false)
    expect(keys.has('external_issue_reference')).toBe(false)
    expect(declaredProperties(actionsShowTool).has('due_at')).toBe(false)
    expect(declaredProperties(actionsShowTool).has('external_issue_reference')).toBe(false)
  })

  it('custom_fields tools drop the v1-only options array', async () => {
    const listKeys = collectKeys(
      await runTransform(customFieldsListTool, { custom_fields: [CUSTOM_FIELD_V2] })
    )
    const showKeys = collectKeys(
      await runTransform(customFieldsShowTool, { custom_field: CUSTOM_FIELD_V2 })
    )

    expect(listKeys.has('options')).toBe(false)
    expect(showKeys.has('options')).toBe(false)
  })

  it('users_list drops total_record_count, which /v2/users never returns', async () => {
    const output = await runTransform(usersListTool, {
      users: [{ id: 'u1', name: 'Lisa', email: 'lisa@incident.io', role: 'owner' }],
      pagination_meta: { after: 'cursor', page_size: 25 },
    })

    expect(collectKeys(output).has('total_record_count')).toBe(false)
    expect(declaredProperties(usersListTool).has('total_record_count')).toBe(false)
    expect(output.pagination_meta).toEqual({ after: 'cursor', page_size: 25 })
  })

  it('incidents_list keeps total_record_count, which its v2 pagination_meta does return', async () => {
    const output = await runTransform(incidentsListTool, {
      incidents: [INCIDENT_V2],
      pagination_meta: { after: 'cursor', page_size: 25, total_record_count: 100 },
    })

    expect(output.pagination_meta.total_record_count).toBe(100)
  })
})

describe('the fixes leave untouched fields byte-identical', () => {
  it('incidents_show still emits every other field it emitted before', async () => {
    const { incident } = await runTransform(incidentsShowTool, { incident: INCIDENT_V2 })

    expect(incident.id).toBe(INCIDENT_V2.id)
    expect(incident.name).toBe(INCIDENT_V2.name)
    expect(incident.summary).toBe(INCIDENT_V2.summary)
    expect(incident.mode).toBe(INCIDENT_V2.mode)
    expect(incident.call_url).toBe(INCIDENT_V2.call_url)
    expect(incident.created_at).toBe(INCIDENT_V2.created_at)
    expect(incident.updated_at).toBe(INCIDENT_V2.updated_at)
    expect(incident.slack_channel_id).toBe(INCIDENT_V2.slack_channel_id)
    expect(incident.slack_channel_name).toBe(INCIDENT_V2.slack_channel_name)
    expect(incident.visibility).toBe(INCIDENT_V2.visibility)
  })

  it('actions_show still emits every field ActionV2 actually carries', async () => {
    const { action } = await runTransform(actionsShowTool, { action: ACTION_V2 })

    expect(action.id).toBe(ACTION_V2.id)
    expect(action.description).toBe(ACTION_V2.description)
    expect(action.status).toBe(ACTION_V2.status)
    expect(action.created_at).toBe(ACTION_V2.created_at)
    expect(action.updated_at).toBe(ACTION_V2.updated_at)
    expect(action.completed_at).toBe(ACTION_V2.completed_at)
    expect(action.incident_id).toBe(ACTION_V2.incident_id)
    expect(action.assignee).toEqual(ACTION_V2.assignee)
    expect(action.creator).toEqual(ACTION_V2.creator)
  })
})
