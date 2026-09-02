/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRandomFloat } = vi.hoisted(() => ({
  mockRandomFloat: vi.fn<() => number>(),
}))

vi.mock('@sim/utils/random', () => ({ randomFloat: mockRandomFloat }))

vi.mock('@/lib/sim-search/connectors', () => {
  const icon = () => null
  const connector = (type: string, name: string, providerId: string) => ({
    type,
    meta: { id: type, name, description: `Sync ${name}`, icon },
    providerId,
    providerIds: [providerId],
    requiredScopes: [],
    serviceName: name,
    serviceIcon: icon,
    blockType: type,
  })
  return {
    isSearchConnectorConnected: (
      candidate: { providerIds: string[] },
      connected: ReadonlySet<string>
    ) => candidate.providerIds.some((providerId) => connected.has(providerId)),
    SEARCH_CONNECTORS: [
      connector('airtable', 'Airtable', 'airtable'),
      connector('confluence', 'Confluence', 'confluence'),
      connector('jira', 'Jira', 'jira'),
      connector('jsm', 'Jira Service Management', 'jira'),
      connector('notion', 'Notion', 'notion'),
      connector('slack', 'Slack', 'slack'),
    ],
  }
})

import { computeConnectorActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/connector-actions'

const ALL_AVAILABLE = () => true

describe('computeConnectorActions', () => {
  beforeEach(() => {
    /** A zero roll always samples the first remaining candidate, so the rotation is catalog order. */
    mockRandomFloat.mockReturnValue(0)
  })

  it('pins Confluence, Jira, and JSM first and fills the last slot from the rotation', () => {
    const actions = computeConnectorActions(new Set(), ALL_AVAILABLE)

    expect(actions.map((action) => action.id)).toEqual([
      'connect-confluence',
      'connect-jira',
      'connect-jsm',
      'connect-airtable',
    ])
    expect(actions[0]).toMatchObject({
      kind: 'connector',
      label: 'Connect Confluence',
      target: { providerId: 'confluence', serviceName: 'Confluence' },
    })
  })

  it('drops every connector on a connected provider and refills from the rotation', () => {
    const actions = computeConnectorActions(new Set(['jira', 'airtable']), ALL_AVAILABLE)

    expect(actions.map((action) => action.id)).toEqual([
      'connect-confluence',
      'connect-notion',
      'connect-slack',
    ])
  })

  it('drops connectors this deployment cannot connect, pinned or not', () => {
    const actions = computeConnectorActions(
      new Set(),
      (connector) => connector.type !== 'jira' && connector.type !== 'airtable'
    )

    expect(actions.map((action) => action.id)).toEqual([
      'connect-confluence',
      'connect-jsm',
      'connect-notion',
      'connect-slack',
    ])
  })

  it('returns fewer than four rows once the rotation is exhausted', () => {
    const actions = computeConnectorActions(new Set(['airtable', 'notion', 'slack']), ALL_AVAILABLE)

    expect(actions.map((action) => action.id)).toEqual([
      'connect-confluence',
      'connect-jira',
      'connect-jsm',
    ])
  })
})
