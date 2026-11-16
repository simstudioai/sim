import { describe, expect, it } from 'vitest'
import { actionsListTool } from '@/tools/incidentio/actions_list'
import { escalationsCreateTool } from '@/tools/incidentio/escalations_create'
import { followUpsListTool } from '@/tools/incidentio/follow_ups_list'
import { followUpsShowTool } from '@/tools/incidentio/follow_ups_show'
import { incidentsUpdateTool } from '@/tools/incidentio/incidents_update'
import { workflowsShowTool } from '@/tools/incidentio/workflows_show'
import { workflowsUpdateTool } from '@/tools/incidentio/workflows_update'
import type { ToolConfig, ToolResponse } from '@/tools/types'

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): URL {
  const { url } = tool.request
  return new URL(typeof url === 'function' ? url(params) : url)
}

function requestBody(tool: ToolConfig, params: Record<string, unknown>): Record<string, unknown> {
  const body = tool.request.body
  if (!body) throw new Error(`${tool.id} has no request body`)
  return body(params) as Record<string, unknown>
}

async function transform(tool: ToolConfig, payload: unknown) {
  if (!tool.transformResponse) throw new Error(`${tool.id} has no transformResponse`)
  return tool.transformResponse(new Response(JSON.stringify(payload)))
}

describe('incident.io requests', () => {
  it('lists actions from the paginated v3 endpoint (v2 is removed on 2026-12-31)', () => {
    const url = requestUrl(actionsListTool, { apiKey: 'k', page_size: 100, after: 'act_9' })
    expect(url.pathname).toBe('/v3/actions')
    expect(url.searchParams.get('page_size')).toBe('100')
    expect(url.searchParams.get('after')).toBe('act_9')
  })

  it('requests a full page of actions and follow-ups unless the caller pages explicitly', () => {
    expect(requestUrl(actionsListTool, { apiKey: 'k' }).searchParams.get('page_size')).toBe('250')
    expect(requestUrl(followUpsListTool, { apiKey: 'k' }).searchParams.get('page_size')).toBe('250')
  })

  it('reads the follow-up creator from the actor envelope', async () => {
    const result = await transform(followUpsShowTool, {
      follow_up: {
        id: 'fu_1',
        title: 'Add alerting',
        status: 'outstanding',
        labels: [],
        creator: { api_key: { id: 'key_1', name: 'Deploy bot' } },
      },
    })
    expect(result.output.follow_up.creator).toMatchObject({
      id: 'key_1',
      name: 'Deploy bot',
      api_key: { id: 'key_1', name: 'Deploy bot' },
    })
  })

  it('outputs the workflow trigger name, not the trigger object', async () => {
    const result = await transform(workflowsShowTool, {
      workflow: { id: 'wf_1', trigger: { name: 'incident.updated', label: 'Incident Updated' } },
    })
    expect(result.output.workflow.trigger).toBe('incident.updated')
  })

  it('accepts already-structured workflow JSON params from a model', () => {
    const body = requestBody(workflowsUpdateTool, {
      apiKey: 'k',
      id: 'wf_1',
      name: 'Notify',
      once_for: [],
      condition_groups: [],
      steps: [{ name: 'slack.post_message' }],
      expressions: '[]',
      runs_on_incident_modes: ['standard'],
    })
    expect(body.steps).toEqual([{ name: 'slack.post_message' }])
    expect(body.once_for).toEqual([])
    expect(body.expressions).toEqual([])
  })

  it('accepts escalation user_ids as an array', () => {
    const body = requestBody(escalationsCreateTool, {
      apiKey: 'k',
      idempotency_key: 'i',
      title: 'DB down',
      user_ids: ['u1', ' u2 '],
    })
    expect(body.user_ids).toEqual(['u1', 'u2'])
  })

  it('never sends an incident type on edit, which incident.io does not support', () => {
    const body = requestBody(incidentsUpdateTool, {
      apiKey: 'k',
      id: 'inc_1',
      incident_type_id: 'type_1',
      notify_incident_channel: false,
    })
    expect(body.incident).toEqual({})
  })
})

describe('incident.io list auto-pagination', () => {
  type ExecuteTool = Parameters<NonNullable<ToolConfig['postProcess']>>[2]

  /** Serves `pageCount` pages of one follow-up each, chained by cursor. */
  function pagedFollowUps(pageCount: number) {
    const calls: Record<string, unknown>[] = []
    const page = (n: number): ToolResponse => ({
      success: true,
      output: {
        follow_ups: [{ id: `fu_${n}` }],
        pagination_meta: { page_size: 250, after: n < pageCount ? `fu_${n}` : undefined },
      },
    })
    const executeTool: ExecuteTool = async (_toolId, params) => {
      calls.push(params)
      return page(Number(String(params.after).slice(3)) + 1)
    }
    return { first: page(1), calls, executeTool }
  }

  async function postProcess(
    tool: ToolConfig,
    result: ToolResponse,
    params: object,
    executeTool: ExecuteTool
  ) {
    if (!tool.postProcess) throw new Error(`${tool.id} has no postProcess`)
    return tool.postProcess(result, params, executeTool)
  }

  it('returns every follow-up, not just the oldest page, when the caller does not page', async () => {
    const { first, calls, executeTool } = pagedFollowUps(3)
    const result = await postProcess(followUpsListTool, first, { apiKey: 'k' }, executeTool)
    expect(result.output.follow_ups.map((f: { id: string }) => f.id)).toEqual([
      'fu_1',
      'fu_2',
      'fu_3',
    ])
    expect(result.output.pagination_meta.after).toBeUndefined()
    expect(calls[0]).toMatchObject({ apiKey: 'k', after: 'fu_1', page_size: 250 })
  })

  it('stops at 2,500 records and leaves the cursor to resume from', async () => {
    const { first, calls, executeTool } = pagedFollowUps(12)
    const result = await postProcess(followUpsListTool, first, { apiKey: 'k' }, executeTool)
    expect(calls).toHaveLength(9)
    expect(result.output.follow_ups).toHaveLength(10)
    expect(result.output.pagination_meta.after).toBe('fu_10')
  })

  it('fetches one page when the caller sets page_size or after', async () => {
    const { first, calls, executeTool } = pagedFollowUps(3)
    await postProcess(followUpsListTool, first, { apiKey: 'k', page_size: 50 }, executeTool)
    await postProcess(actionsListTool, first, { apiKey: 'k', after: 'act_1' }, executeTool)
    expect(calls).toHaveLength(0)
  })

  it('fails instead of returning a partial list when a later page fails', async () => {
    const first: ToolResponse = {
      success: true,
      output: { actions: [{ id: 'act_1' }], pagination_meta: { page_size: 250, after: 'act_1' } },
    }
    const failing: ExecuteTool = async () => ({ success: false, output: {}, error: 'rate limited' })
    const result = await postProcess(actionsListTool, first, { apiKey: 'k' }, failing)
    expect(result.success).toBe(false)
    expect(result.error).toBe('rate limited')
  })
})
