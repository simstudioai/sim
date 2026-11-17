import { describe, expect, it } from 'vitest'
import { linearArchiveLabelTool } from '@/tools/linear/archive_label'
import { linearCreateCustomerRequestTool } from '@/tools/linear/create_customer_request'
import { linearCreateCustomerTierTool } from '@/tools/linear/create_customer_tier'
import { linearDeleteProjectStatusTool } from '@/tools/linear/delete_project_status'
import { linearListProjectsTool } from '@/tools/linear/list_projects'
import { linearUpdateCustomerRequestTool } from '@/tools/linear/update_customer_request'
import { linearUpdateCustomerStatusTool } from '@/tools/linear/update_customer_status'
import { linearUpdateCustomerTierTool } from '@/tools/linear/update_customer_tier'
import { linearUpdateNotificationTool } from '@/tools/linear/update_notification'
import { linearUpdateProjectTool } from '@/tools/linear/update_project'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GraphqlBody {
  query: string
  variables: { input?: Record<string, unknown>; filter?: unknown }
}

function graphqlBody<P, R extends ToolResponse>(tool: ToolConfig<P, R>, params: P): GraphqlBody {
  const build = tool.request.body
  if (!build) throw new Error(`${tool.id} has no request body`)
  return build(params) as GraphqlBody
}

async function transform<P, R extends ToolResponse>(
  tool: ToolConfig<P, R>,
  payload: unknown,
  params?: P
): Promise<ToolResponse> {
  if (!tool.transformResponse) throw new Error(`${tool.id} has no transformResponse`)
  return tool.transformResponse(new Response(JSON.stringify(payload)), params)
}

describe('Linear customer tier and status payloads', () => {
  it('returns the tier Linear sends back from customerTierCreate', async () => {
    const tier = { id: 't1', name: 'Enterprise' }
    const result = await transform(linearCreateCustomerTierTool, {
      data: { customerTierCreate: { success: true, tier } },
    })
    expect(result.success).toBe(true)
    expect(result.output.customerTier).toEqual(tier)
  })

  it('returns the tier Linear sends back from customerTierUpdate', async () => {
    const tier = { id: 't1', name: 'Pro' }
    const result = await transform(linearUpdateCustomerTierTool, {
      data: { customerTierUpdate: { success: true, tier } },
    })
    expect(result.output.customerTier).toEqual(tier)
  })

  it('returns the status Linear sends back from customerStatusUpdate', async () => {
    const status = { id: 's1', name: 'Active' }
    const result = await transform(linearUpdateCustomerStatusTool, {
      data: { customerStatusUpdate: { success: true, status } },
    })
    expect(result.output.customerStatus).toEqual(status)
  })
})

describe('Linear archive mutations', () => {
  it('retires the label and reports the retire result', async () => {
    const body = graphqlBody(linearArchiveLabelTool, { labelId: 'l1', accessToken: 'tok' })
    expect(body.query).toContain('issueLabelRetire(id: $id)')
    const result = await transform(
      linearArchiveLabelTool,
      { data: { issueLabelRetire: { success: true } } },
      { labelId: 'l1' }
    )
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ success: true, labelId: 'l1' })
  })

  it('archives the project status and reports the archive result', async () => {
    const body = graphqlBody(linearDeleteProjectStatusTool, { statusId: 'ps1', accessToken: 'tok' })
    expect(body.query).toContain('projectStatusArchive(id: $id)')
    const result = await transform(linearDeleteProjectStatusTool, {
      data: { projectStatusArchive: { success: true } },
    })
    expect(result.success).toBe(true)
  })
})

describe('Linear list projects team filter', () => {
  it('filters by team on the server so pagination matches the filtered set', () => {
    const body = graphqlBody(linearListProjectsTool, { teamId: ' team-1 ', accessToken: 'tok' })
    expect(body.variables.filter).toEqual({
      accessibleTeams: { some: { id: { eq: 'team-1' } } },
    })
  })

  it('returns every project on the page Linear returns', async () => {
    const result = await transform(
      linearListProjectsTool,
      {
        data: {
          projects: {
            nodes: [{ id: 'p1', teams: { nodes: [{ id: 'other-team' }] } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
      { teamId: 'team-1' }
    )
    expect(result.output.projects.map((project: { id: string }) => project.id)).toEqual(['p1'])
  })
})

describe('Linear update project status', () => {
  it('sends statusId, never the removed state input', () => {
    const body = graphqlBody(linearUpdateProjectTool, {
      projectId: 'p1',
      statusId: 'ps1',
      state: 'started',
      accessToken: 'tok',
    })
    expect(body.variables.input).toEqual({ statusId: 'ps1' })
  })

  it('fails before calling Linear when only a state is given', () => {
    expect(() =>
      graphqlBody(linearUpdateProjectTool, {
        projectId: 'p1',
        state: 'started',
        accessToken: 'tok',
      })
    ).toThrow('statusId')
  })
})

describe('Linear customer requests', () => {
  it('never sends projectId, which the create input no longer accepts', () => {
    const body = graphqlBody(linearCreateCustomerRequestTool, {
      customerId: 'c1',
      issueId: 'ENG-1',
      projectId: 'p1',
      accessToken: 'tok',
    })
    expect(body.variables.input).not.toHaveProperty('projectId')
  })

  it('never sends projectId, which the update input does not accept', () => {
    const body = graphqlBody(linearUpdateCustomerRequestTool, {
      customerNeedId: 'n1',
      projectId: 'p1',
      accessToken: 'tok',
    })
    expect(body.variables.input).not.toHaveProperty('projectId')
  })
})

describe('Linear update notification', () => {
  it('reads the issue through the IssueNotification fragment', () => {
    const body = graphqlBody(linearUpdateNotificationTool, {
      notificationId: 'n1',
      accessToken: 'tok',
    })
    expect(body.query).toMatch(/\.\.\. on IssueNotification \{\s*issue \{/)
  })

  it('marks a notification read now when readAt is blank', () => {
    const body = graphqlBody(linearUpdateNotificationTool, {
      notificationId: 'n1',
      readAt: '',
      accessToken: 'tok',
    })
    expect(typeof body.variables.input?.readAt).toBe('string')
    expect(body.variables.input?.readAt).not.toBe('')
  })
})
