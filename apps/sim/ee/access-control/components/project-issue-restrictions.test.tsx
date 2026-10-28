/** @vitest-environment jsdom */

import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers'
import { jsonResponse } from '@sim/testing/helpers/http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { ProjectIssueRestrictions } from '@/ee/access-control/components/project-issue-restrictions'

let root: Root
let container: HTMLDivElement
let client: QueryClient
let requests: string[]

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      return jsonResponse({
        projects: [
          {
            id: 'project-1',
            name: 'Payments',
            organizationId: 'org-1',
            ownerId: 'user-1',
            archivedAt: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            environments: [],
            capabilities: { administer: true, issues: true },
          },
        ],
        nextCursor: null,
      })
    })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  client.clear()
  container.remove()
})

async function render(projects: boolean) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <FeatureFlagsProvider
          flags={{
            dashboards: false,
            'workflow-tests': false,
            changelog: false,
            'mothership-model-selector': false,
            'mothership-plan-mode': false,
            projects,
          }}
        >
          <ProjectIssueRestrictions organizationId='org-1' value={[]} onChange={() => {}} />
        </FeatureFlagsProvider>
      </QueryClientProvider>
    )
  })
  await act(() => flushMacrotask())
}

describe('ProjectIssueRestrictions', () => {
  it('never reads the Project APIs while the projects flag is off', async () => {
    await render(false)
    expect(requests).toEqual([])
    expect(container.querySelector('#project-issues-project-1')).toBeNull()
  })

  it('offers each authorized Project once the projects flag is on', async () => {
    await render(true)
    expect(requests.some((url) => url.startsWith('/api/projects?'))).toBe(true)
    expect(container.querySelector('#project-issues-project-1')).not.toBeNull()
  })

  it('hides Projects loaded before the projects flag turned off', async () => {
    await render(true)
    act(() => root.unmount())
    root = createRoot(container)
    requests = []
    await render(false)
    expect(requests).toEqual([])
    expect(container.querySelector('#project-issues-project-1')).toBeNull()
  })
})
