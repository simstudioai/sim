/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  connectCustomSlackSearchContract,
  listSlackSearchContract,
  type SlackSearchList,
} from '@/lib/api/contracts/knowledge/slack'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))

import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import {
  useConnectCustomSlackSearch,
  useSlackSearchInstallations,
} from '@/hooks/queries/slack-search'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'

let root: Root
let client: QueryClient
let connection: ReturnType<typeof useConnectCustomSlackSearch>

function Probe() {
  connection = useConnectCustomSlackSearch()
  useSlackSearchInstallations('org-1')
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.request.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(document.createElement('div'))
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('refreshes the installed app before completing the wizard and invalidates its setup data', async () => {
  const input = {
    organizationId: 'org-1',
    name: 'Sim Search',
    description: 'Search',
    clientId: 'client',
    clientSecret: 'secret',
    signingSecret: 'signing',
    botToken: 'xoxb-installed',
  }
  const empty: SlackSearchList = { sharedAppAvailable: false, installations: [], bots: [] }
  const installed: SlackSearchList = {
    ...empty,
    installations: [
      {
        id: 'installed',
        credentialId: 'credential',
        appId: 'A1',
        teamId: 'T1',
        teamName: 'Team',
        appKind: 'custom',
        enabled: true,
        needsValidation: false,
        lastOutcome: null,
        lastEventAt: null,
      },
    ],
  }
  let finishRefresh!: (value: SlackSearchList) => void
  const refresh = new Promise<SlackSearchList>((resolve) => {
    finishRefresh = resolve
  })
  mocks.request
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce({ organizationId: 'org-1' })
    .mockReturnValueOnce(refresh)
  const manifestKey = slackSearchKeys.manifest('org-1', 'Sim Search')
  const accountsKey = organizationAccountsKeys.detail('org-1')
  const otherKey = slackSearchKeys.list('org-2')
  for (const key of [manifestKey, accountsKey, otherKey]) client.setQueryData(key, {})
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  )
  const completed = vi.fn()
  await act(async () => {
    connection.mutate(input, { onSuccess: completed })
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(mocks.request).toHaveBeenNthCalledWith(2, connectCustomSlackSearchContract, {
    body: input,
  })
  expect(completed).not.toHaveBeenCalled()
  expect(client.getQueryData(slackSearchKeys.list('org-1'))).toEqual(empty)
  await act(async () => {
    finishRefresh(installed)
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(completed).toHaveBeenCalledOnce()
  expect(client.getQueryData(slackSearchKeys.list('org-1'))).toEqual(installed)
  expect(client.getQueryState(manifestKey)?.isInvalidated).toBe(true)
  expect(client.getQueryState(accountsKey)?.isInvalidated).toBe(true)
  expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false)
  expect(mocks.request).toHaveBeenCalledTimes(3)
  expect(mocks.request.mock.calls[2][0]).toBe(listSlackSearchContract)
})
