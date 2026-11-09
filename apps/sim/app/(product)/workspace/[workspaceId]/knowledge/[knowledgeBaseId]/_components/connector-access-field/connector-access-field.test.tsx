/**
 * @vitest-environment node
 *
 * Failure mode: "Set up Slack" sending an administrator to a workspace Settings section that does
 * not exist, instead of the organization's Slack section where the credential group members
 * connect through is configured.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/platform/lib/data/knowledge/connectors', () => ({
  useConnectorAccessField: () => ({
    hidden: false,
    singleMode: false,
    modes: [],
    visibleModes: [],
    currentMode: { allowed: true },
    showModeSelector: false,
    showSlackSetup: true,
    configured: false,
    accountsQuery: { isError: false, isSuccess: true, isFetching: false, refetch: vi.fn() },
  }),
}))

import { ConnectorAccessField } from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/connector-access-field/connector-access-field'
import type { ConnectorMeta } from '@/platform/lib/data/knowledge/connectors'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'

describe('Set up Slack', () => {
  it("links to the organization's Slack section", () => {
    const markup = renderToStaticMarkup(
      <SurfaceScopeProvider routePrefix='/o/org-1'>
        <ConnectorAccessField
          workspaceId='ws-1'
          connectorConfig={{} as ConnectorMeta}
          accessMode='members'
          onChange={vi.fn()}
          canAdmin
          allowMembers
          allowAdmin={false}
          allowWorkspace={false}
        />
      </SurfaceScopeProvider>
    )

    const href = markup.match(/href="([^"]+)"/)?.[1]
    expect(href).toBe('/o/org-1/settings/search-slack')
  })
})
