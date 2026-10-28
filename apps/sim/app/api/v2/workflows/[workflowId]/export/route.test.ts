import { apiServerRoutesMock } from '@sim/testing/mocks/api-server-routes.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)

import { v2ExportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { GET } from '@/app/api/v2/workflows/[workflowId]/export/route'

describe('/api/v2/workflows/[workflowId]/export route definition', () => {
  /**
   * The export is sharing-safe by default: workspace bindings are cleared. A
   * caller round-tripping into the same workspace opts in per request, and the
   * flag must reach the use case rather than stop at the query parser.
   */
  it('forwards independent reference and workspace-binding options', () => {
    const mapInput = Reflect.get(GET, 'mapInput') as (args: {
      params: { workflowId: string }
      query: { includeReferences?: boolean; includeWorkspaceBindings: boolean }
    }) => Record<string, unknown>

    expect(v2ExportWorkflowContract.query.parse({})).toEqual({ includeWorkspaceBindings: false })
    expect(v2ExportWorkflowContract.query.parse({ includeWorkspaceBindings: 'true' })).toEqual({
      includeWorkspaceBindings: true,
    })
    expect(
      mapInput({ params: { workflowId: 'workflow-1' }, query: { includeWorkspaceBindings: true } })
    ).toEqual({
      workflowId: 'workflow-1',
      includeReferences: false,
      includeWorkspaceBindings: true,
    })
    expect(
      mapInput({
        params: { workflowId: 'workflow-1' },
        query: v2ExportWorkflowContract.query.parse({
          includeReferences: 'true',
          includeWorkspaceBindings: 'true',
        }),
      })
    ).toEqual({ workflowId: 'workflow-1', includeReferences: true, includeWorkspaceBindings: true })
  })
})
