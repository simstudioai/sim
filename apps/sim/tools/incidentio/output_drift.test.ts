/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'
import { customFieldsCreateTool } from '@/tools/incidentio/custom_fields_create'
import { escalationsCreateTool } from '@/tools/incidentio/escalations_create'
import { escalationsListTool } from '@/tools/incidentio/escalations_list'
import { escalationsShowTool } from '@/tools/incidentio/escalations_show'
import { incidentUpdatesListTool } from '@/tools/incidentio/incident_updates_list'
import { incidentsCreateTool } from '@/tools/incidentio/incidents_create'
import { incidentsListTool } from '@/tools/incidentio/incidents_list'
import { incidentsShowTool } from '@/tools/incidentio/incidents_show'
import { incidentsUpdateTool } from '@/tools/incidentio/incidents_update'
import { workflowsCreateTool } from '@/tools/incidentio/workflows_create'
import { workflowsUpdateTool } from '@/tools/incidentio/workflows_update'

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new Error(`expected an object, received ${typeof value}`)
  }
  return value as Record<string, unknown>
}

/**
 * Walks a tool's declared `outputs` tree and returns the property names at `path`,
 * transparently stepping through `items` for array-typed nodes.
 */
function declaredPropertyNames(outputs: unknown, path: readonly string[]): string[] {
  let node: unknown = outputs
  for (const segment of path) {
    const child = asRecord(asRecord(node)[segment])
    const container = asRecord(child.items ?? child)
    node = container.properties ?? {}
  }
  return Object.keys(asRecord(node))
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Shaped after `IncidentV2` in https://api.incident.io/v1/openapiV3.json. */
const SPEC_INCIDENT = {
  id: '01FCNDV6P870EA6S7TK1DSYDG0',
  name: 'Database outage',
  reference: 'INC-123',
  summary: 'Primary database is unreachable',
  mode: 'standard',
  call_url: 'https://zoom.us/j/123',
  permalink: 'https://app.incident.io/incidents/123',
  incident_status: { id: 'st_1', name: 'Live', category: 'live' },
  severity: { id: 'sev_1', name: 'Major', rank: 2 },
  incident_type: { id: 'ty_1', name: 'Default' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  slack_channel_id: 'C123',
  slack_channel_name: 'inc-123',
  visibility: 'public',
  custom_field_entries: [],
  incident_role_assignments: [],
}

const INCIDENT_TOOLS = [
  { tool: incidentsCreateTool, path: ['incident'] as const },
  { tool: incidentsUpdateTool, path: ['incident'] as const },
  { tool: incidentsShowTool, path: ['incident'] as const },
] as const

describe('incident permalink output', () => {
  it('declares permalink and not incident_url on every v2 incident tool', () => {
    const listFields = declaredPropertyNames(incidentsListTool.outputs, ['incidents'])
    expect(listFields).toContain('permalink')
    expect(listFields).not.toContain('incident_url')

    for (const { tool, path } of INCIDENT_TOOLS) {
      const fields = declaredPropertyNames(tool.outputs, path)
      expect(fields).toContain('permalink')
      expect(fields).not.toContain('incident_url')
    }
  })

  it('maps the API permalink field onto the declared permalink output', async () => {
    const list = await incidentsListTool.transformResponse!(
      jsonResponse({ incidents: [SPEC_INCIDENT] }),
      {} as never
    )
    expect(list.output.incidents[0].permalink).toBe('https://app.incident.io/incidents/123')

    for (const { tool } of INCIDENT_TOOLS) {
      const result = await tool.transformResponse!(
        jsonResponse({ incident: SPEC_INCIDENT }),
        {} as never
      )
      const incident = asRecord(asRecord(result.output).incident)
      expect(incident.permalink).toBe('https://app.incident.io/incidents/123')
      expect(incident).not.toHaveProperty('incident_url')
    }
  })
})

describe('incident description output', () => {
  it('does not declare a description field, which IncidentV2 has no counterpart for', () => {
    expect(declaredPropertyNames(incidentsListTool.outputs, ['incidents'])).not.toContain(
      'description'
    )
    for (const { tool, path } of INCIDENT_TOOLS) {
      expect(declaredPropertyNames(tool.outputs, path)).not.toContain('description')
    }
  })

  it('does not emit a description key from a spec-shaped incident', async () => {
    const list = await incidentsListTool.transformResponse!(
      jsonResponse({ incidents: [SPEC_INCIDENT] }),
      {} as never
    )
    expect(asRecord(list.output.incidents[0])).not.toHaveProperty('description')
  })
})

/** Shaped after `IncidentUpdateV2` in https://api.incident.io/v1/openapiV3.json. */
const SPEC_INCIDENT_UPDATE = {
  id: 'upd_1',
  incident_id: '01FCNDV6P870EA6S7TK1DSYDG0',
  message: 'Mitigation in progress',
  new_incident_status: { id: 'st_1', name: 'Live', category: 'live' },
  new_severity: { id: 'sev_1', name: 'Major', rank: 2 },
  updater: { user: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' } },
  created_at: '2026-01-01T00:00:00Z',
}

describe('incident_updates new_incident_status output', () => {
  it('declares new_incident_status instead of new_status', () => {
    const fields = declaredPropertyNames(incidentUpdatesListTool.outputs, ['incident_updates'])
    expect(fields).toContain('new_incident_status')
    expect(fields).not.toContain('new_status')
  })

  it('declares the updater actor wrapper rather than a flat user', () => {
    const updaterFields = declaredPropertyNames(incidentUpdatesListTool.outputs, [
      'incident_updates',
      'updater',
    ])
    expect(updaterFields.sort()).toEqual(['alert', 'api_key', 'user', 'workflow'])
    expect(
      declaredPropertyNames(incidentUpdatesListTool.outputs, [
        'incident_updates',
        'updater',
        'user',
      ])
    ).toEqual(['id', 'name', 'email'])
  })

  it('does not declare updated_at, which IncidentUpdateV2 does not return', () => {
    expect(
      declaredPropertyNames(incidentUpdatesListTool.outputs, ['incident_updates'])
    ).not.toContain('updated_at')
  })

  it('passes the spec-shaped update through under the declared names', async () => {
    const result = await incidentUpdatesListTool.transformResponse!(
      jsonResponse({ incident_updates: [SPEC_INCIDENT_UPDATE] }),
      {} as never
    )
    const update = asRecord(result.output.incident_updates[0])
    expect(asRecord(update.new_incident_status).name).toBe('Live')
    expect(update).not.toHaveProperty('new_status')
    expect(asRecord(asRecord(update.updater).user).name).toBe('Ada')
  })
})

/** Shaped after `EscalationV2` in https://api.incident.io/v1/openapiV3.json. */
const SPEC_ESCALATION = {
  id: 'esc_1',
  title: 'Database Critical Alert',
  description: 'Paging the primary on-call',
  status: 'triggered',
  priority: { name: 'P1' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:05:00Z',
}

describe('escalation title output', () => {
  it('declares title and status instead of name', () => {
    expect(declaredPropertyNames(escalationsListTool.outputs, ['escalations']).sort()).toEqual([
      'created_at',
      'description',
      'id',
      'priority',
      'status',
      'title',
      'updated_at',
    ])
    for (const tool of [escalationsShowTool, escalationsCreateTool]) {
      const fields = declaredPropertyNames(tool.outputs, ['escalation'])
      expect(fields).toContain('title')
      expect(fields).toContain('status')
      expect(fields).not.toContain('name')
    }
  })

  it('passes the spec-shaped escalation through under the declared names', async () => {
    const result = await escalationsListTool.transformResponse!(
      jsonResponse({ escalations: [SPEC_ESCALATION], pagination_meta: { page_size: 25 } }),
      {} as never
    )
    const escalation = asRecord(result.output.escalations[0])
    expect(escalation.title).toBe('Database Critical Alert')
    expect(escalation.status).toBe('triggered')
    expect(escalation).not.toHaveProperty('name')
  })
})

function paramDescription(
  tool: { params: Record<string, { description?: string }> },
  name: string
): string {
  const description = tool.params[name]?.description
  if (typeof description !== 'string') {
    throw new Error(`param ${name} has no description`)
  }
  return description
}

describe('workflows_create runs_on_incidents description', () => {
  it('advertises only the two values WorkflowsCreateWorkflowPayloadV2 accepts', () => {
    const description = paramDescription(workflowsCreateTool, 'runs_on_incidents')
    expect(description).toBe(
      'When to run the workflow: "newly_created" (only newly created incidents) or "newly_created_and_active" (newly created and already active incidents)'
    )
    expect(description).not.toMatch(/"active"|"all"/)
  })
})

describe('workflows_update runs_on_incidents description', () => {
  it('advertises only the two values WorkflowsUpdateWorkflowPayloadV2 accepts', () => {
    const description = paramDescription(workflowsUpdateTool, 'runs_on_incidents')
    expect(description).toBe('When to run the workflow: newly_created or newly_created_and_active')
    expect(description).not.toMatch(/\bactive,|\ball\b/)
  })
})

describe('custom_fields_create field_type description', () => {
  it('advertises only the five values CustomFieldsCreatePayloadV2 accepts', () => {
    const description = paramDescription(customFieldsCreateTool, 'field_type')
    expect(description).toBe(
      'Type of the custom field: text, link, numeric, single_select, or multi_select'
    )
    for (const rejected of ['datetime', 'user', 'team']) {
      expect(description).not.toContain(rejected)
    }
  })
})

/**
 * `WorkflowsCreate/UpdateWorkflowPayloadV2.runs_on_incidents` accepts exactly
 * `newly_created` and `newly_created_and_active`. The block previously offered
 * `active` and `all` as well, so a user could pick a value the API rejects with
 * a 422 — the tool-side description alone does not close that path.
 */
describe('the block only offers runs_on_incidents values the API accepts', () => {
  const SPEC_ENUM = ['newly_created', 'newly_created_and_active']

  it('offers exactly the spec enum', () => {
    const sub = IncidentioBlock.subBlocks.find((s) => s.id === 'runs_on_incidents')
    expect(sub).toBeDefined()
    const ids = (sub!.options as Array<{ id: string }>).map((o) => o.id)
    expect(ids).toEqual(SPEC_ENUM)
  })

  it('defaults to a value the API accepts', () => {
    const sub = IncidentioBlock.subBlocks.find((s) => s.id === 'runs_on_incidents')
    expect(SPEC_ENUM).toContain((sub as { value: () => string }).value())
  })
})

/**
 * `updater` is an `ActorV2`, a four-branch union. Declaring only `user` meant an
 * update made by an API key, workflow or alert had no reachable actor fields.
 */
describe('updater declares every ActorV2 branch', () => {
  it('covers user, api_key, workflow and alert', () => {
    const updater = (
      incidentUpdatesListTool.outputs?.incident_updates as {
        items?: { properties?: Record<string, { properties?: Record<string, unknown> }> }
      }
    )?.items?.properties?.updater
    expect(Object.keys(updater?.properties ?? {}).sort()).toEqual([
      'alert',
      'api_key',
      'user',
      'workflow',
    ])
  })
})

/** `description` and `priority` are both in EscalationV2's required set. */
describe('escalations declare the fields the spec marks required', () => {
  it.each([
    ['escalations_create', escalationsCreateTool],
    ['escalations_show', escalationsShowTool],
    ['escalations_list', escalationsListTool],
  ])('%s', (_name, tool) => {
    const declared = JSON.stringify(tool.outputs)
    expect(declared).toContain('description')
    expect(declared).toContain('priority')
  })
})
