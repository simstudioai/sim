/**
 * @vitest-environment jsdom
 *
 * Failure mode: a held window shows another scope's numbers, when the workspace or organization
 * changes rather than the window.
 */
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOrganizationActivitySummary } from '@/hooks/queries/organization-activity'
import { renderDataHook, unmountDataHooks } from '@/platform/embedded/lib/render-hook.test-support'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('next/navigation', () => nextNavigationMock)

const WEEK = { days: 7 } as never
const MONTH = { days: 30 } as never

describe('holding the last window', () => {
  beforeEach(() => {
    apiClientRequestMockFns.mockRequestJson.mockReset()
    let reads = 0
    apiClientRequestMockFns.mockRequestJson.mockImplementation(() =>
      reads++ === 0 ? Promise.resolve({ read: 'first' }) : new Promise(() => {})
    )
  })
  afterEach(unmountDataHooks)

  async function renderFirstThen(next: { window: never; workspaceId?: string }) {
    let props: { window: never; workspaceId?: string } = { window: WEEK }
    const rendered = await renderDataHook(() =>
      useOrganizationActivitySummary('org-1', props.window, {
        workspaceId: props.workspaceId,
        keepPreviousWindow: true,
      })
    )
    await vi.waitFor(() => expect(rendered.result.current.data).toEqual({ read: 'first' }))
    props = next
    await rendered.rerender()
    return rendered.result.current.data
  }

  it('keeps showing the last read while a wider window loads', async () => {
    expect(await renderFirstThen({ window: MONTH })).toEqual({ read: 'first' })
  })

  it('shows nothing of another workspace while it loads', async () => {
    expect(await renderFirstThen({ window: WEEK, workspaceId: 'ws-2' })).toBeUndefined()
  })
})
