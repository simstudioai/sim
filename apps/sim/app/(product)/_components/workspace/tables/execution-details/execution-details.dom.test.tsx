/**
 * @vitest-environment jsdom
 *
 * A table cell's run, read through the Logs adapter. Failure modes: the table panel losing what it
 * showed before it shared the Logs pieces (the legacy level, the failure, the workflow's input,
 * files, cost, a model step's thinking and tool calls and its fuller facts); content the server
 * withheld shown as empty instead of withheld; and a viewer whose permission group hides traces
 * seeing the trace, input or output.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/platform/lib/data/organization', () => ({
  useOrganization: () => ({ organization: { id: 'org-1' }, mothershipAvailable: true }),
}))

import { ExecutionDetailsPanel } from '@/app/(product)/_components/workspace/tables/execution-details/execution-details'
import { WorkspaceSession } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'

const WORKSPACE_ID = 'ws-1'
const EXECUTION_ID = 'exec-1'
const STARTED = '2026-11-10T12:00:00.000Z'

/** A failed run: an agent whose model turn thought and asked for a tool, then a block whose content was withheld. */
const LOG = {
  id: 'log-1',
  workflowId: 'wf-1',
  executionId: EXECUTION_ID,
  deploymentVersionId: null,
  deploymentVersion: 3,
  deploymentVersionName: null,
  executionOrigin: null,
  level: 'error',
  status: 'failed',
  duration: '2000ms',
  trigger: 'slack_webhook',
  createdAt: STARTED,
  workflow: { id: 'wf-1', name: 'Support triage' },
  jobTitle: null,
  cost: { total: 0.012 },
  pauseSummary: { status: 'none', total: 0, resumed: 0 },
  hasPendingPause: false,
  files: [
    {
      id: 'file-1',
      name: 'report.csv',
      url: '',
      key: 'execution/report.csv',
      size: 2048,
      type: 'text/csv',
    },
  ],
  costLedger: {
    total: 0.012,
    items: [
      { category: 'fixed', description: 'execution_fee', cost: 0.005 },
      {
        category: 'model',
        description: 'claude',
        cost: 0.007,
        inputTokens: 120,
        outputTokens: 40,
      },
    ],
  },
  executionData: {
    totalDuration: 2000,
    workflowInput: { ticket: 'T-42' },
    finalOutput: { error: 'Lookup failed: no such customer' },
    traceSpans: [
      {
        id: 'agent-1',
        name: 'Agent 1',
        type: 'agent',
        duration: 1200,
        startTime: STARTED,
        endTime: '2026-11-10T12:00:01.200Z',
        status: 'success',
        children: [
          {
            id: 'model-1',
            name: 'claude-sonnet',
            type: 'model',
            duration: 800,
            startTime: STARTED,
            endTime: '2026-11-10T12:00:00.800Z',
            status: 'success',
            provider: 'anthropic',
            model: 'claude-sonnet',
            finishReason: 'tool_use',
            ttft: 320,
            tokens: { input: 120, output: 40, total: 160, cacheRead: 64 },
            thinking: 'The ticket names a customer; look them up first.',
            modelToolCalls: [{ id: 'call-1', name: 'lookup_customer', arguments: {} }],
          },
          {
            id: 'tool-1',
            name: 'lookup_customer',
            type: 'tool',
            duration: 300,
            startTime: '2026-11-10T12:00:00.800Z',
            endTime: '2026-11-10T12:00:01.100Z',
            status: 'success',
          },
        ],
      },
      {
        id: 'lookup-1',
        name: 'Lookup',
        type: 'api',
        duration: 500,
        startTime: '2026-11-10T12:00:01.300Z',
        endTime: '2026-11-10T12:00:01.800Z',
        status: 'error',
        errorMessage: 'Lookup failed: no such customer',
        contentWithheld: true,
      },
    ],
  },
}

let hideTraceSpans = false
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  // jsdom lays nothing out; the trace scrolls its selected step into view.
  Element.prototype.scrollIntoView = () => {}
  hideTraceSpans = false
  apiClientRequestMockFns.mockRequestJson.mockImplementation(async (contract) => {
    if (contract.path === '/api/logs/by-execution/[executionId]') return { data: LOG }
    if (contract.path === '/api/permission-groups/user')
      return { permissionGroupId: null, groupName: null, config: { hideTraceSpans } }
    throw new Error(`Unexpected read of ${contract.path}`)
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Not found' }, { status: 404 }))
  )
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: { id: 'viewer', name: 'Viewer', email: 'viewer@sim.test', image: null } },
    isPending: false,
    error: null,
  })
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>
          <WorkspaceSession mode='live'>
            <ExecutionDetailsPanel
              workspaceId={WORKSPACE_ID}
              executionId={EXECUTION_ID}
              onClose={() => {}}
            />
          </WorkspaceSession>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
  for (let round = 0; round < 6; round++) await act(flushMacrotask)
}

function text() {
  return container.textContent ?? ''
}

function tab(name: string) {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (candidate) => candidate.textContent?.trim() === name
  )
}

async function select(element: HTMLElement | undefined) {
  if (!element) throw new Error('Nothing to select')
  await act(async () => element.click())
  for (let round = 0; round < 3; round++) await act(flushMacrotask)
}

function traceRow(name: string) {
  return [...container.querySelectorAll<HTMLElement>('[data-trace-id] button, [data-trace-id]')]
    .filter((row) => row.textContent?.includes(name))
    .at(-1)
}

it('shows the run overview a table cell showed before: level, failure, input, files and cost', async () => {
  await render()
  const overview = text()
  expect(overview).toContain('Error')
  expect(overview).toContain('Lookup failed: no such customer')
  expect(overview).toContain('Support triage')
  expect(overview).toContain('Slack Webhook')
  expect(overview).toContain('T-42')
  expect(overview).toContain('report.csv')
  expect(overview).toContain('Base Run')
  expect(overview).toContain('120 in · 40 out')
})

it('opens the trace at the failure, withheld content read as withheld', async () => {
  await render()
  await select(tab('Trace'))
  expect(text()).toContain('Jump to error')
  expect(text()).toContain('Content withheld')
})

it('shows a model step’s thinking, tool calls and fuller facts', async () => {
  await render()
  await select(tab('Trace'))
  await select(traceRow('claude-sonnet'))
  const step = text()
  expect(step).toContain('The ticket names a customer; look them up first.')
  expect(step).toContain('Tool calls')
  expect(step).toContain('tool_use')
  expect(step).toContain('320ms')
  expect(step).toContain('Cache read')
})

it('shows no trace, input or output to a viewer whose permission group hides traces', async () => {
  hideTraceSpans = true
  await render()
  expect(tab('Trace')).toBeUndefined()
  expect(text()).not.toContain('T-42')
  expect(text()).toContain('report.csv')
})
