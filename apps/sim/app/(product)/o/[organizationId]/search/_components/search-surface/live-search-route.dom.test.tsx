/**
 * @vitest-environment jsdom
 *
 * The live shell's provider hydrates above the shell's Suspense boundary, so its reads start before
 * the sidebar and the Search page hydrate. Failure modes: the sidebar of a member with no
 * workspaces painting differently from the server's markup, which React answers with #418 and a
 * client re-render. The server seeds the session and the workspace list, as `prefetchShell` does,
 * and every other read stays in flight on both sides. The viewer's remembered Search mode lives in
 * a browser cookie the server markup never saw: read during hydration, it paints a different mode
 * than the server did.
 */

import { act, type ReactNode, Suspense } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { type DehydratedState, dehydrate, QueryClient, useQueryClient } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
/** The URL's query string; the route under test reads it through nuqs. */
let routeSearch = '?mode=search'
vi.mock('nuqs/adapters/next/app', () => ({
  NuqsAdapter: ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={routeSearch}>{children}</NuqsTestingAdapter>
  ),
}))

import { ProductSession } from '@/app/(product)/_components/product-session'
import { SearchSurface } from '@/app/(product)/o/[organizationId]/search/_components/search-surface/search-surface'
import { workspaceKeys } from '@/hooks/queries/utils/workspace-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { LiveProviders } from '@/platform/lib/data/providers'

const ORGANIZATION_ID = 'org-narrow'
/** The cookie Search remembers the viewer's last mode in, `<userId>:<mode>`. */
const SEARCH_MODE_COOKIE = `search_mode_${ORGANIZATION_ID}`

/** A member in a restrictive permission group: Search only, no build, no workspaces. */
const NARROW_MEMBER_SURFACE = {
  organization: { id: ORGANIZATION_ID, name: 'Org', slug: 'org', logo: null, memberCount: 5 },
  routePrefix: `/o/${ORGANIZATION_ID}`,
  viewer: {
    role: 'member',
    isAdmin: false,
    canInviteMembers: false,
    canConnectSearchIntegrations: true,
    canUsePersonalApiKeys: false,
    canUseSearchMcp: true,
  },
  mothershipAvailable: true,
  canBuild: false,
  searchAccess: { sourceMirrored: true, memberScoped: true },
  connectedAccountsAvailable: true,
  settingsFeatures: {
    billingEnabled: true,
    hasEnterprisePlan: true,
    governanceActive: true,
    hosted: true,
    selfHosted: {},
    personal: false,
  },
  deployment: {
    hosted: true,
    billingEnabled: true,
    chatEnabled: true,
    azureConfigured: false,
    cohereConfigured: false,
    invitationsDisabled: false,
    features: {
      accessControl: true,
      auditLogs: false,
      customBlocks: false,
      dataDrains: false,
      dataRetention: false,
      inbox: false,
      sandboxes: false,
      scim: false,
      sessionPolicies: false,
      sso: false,
      usageMonitoring: false,
      whitelabeling: false,
    },
  },
  navFlags: {
    people: false,
    simLinks: false,
    benchmark: false,
    platformAdmin: false,
    anonymous: false,
  },
  featureFlags: {
    dashboards: false,
    'workflow-tests': false,
    changelog: false,
    'mothership-model-selector': false,
    'mothership-computer-use': false,
    'mothership-plan-mode': false,
    'mothership-memory-spaces': false,
    projects: false,
  },
  settingsSections: [],
} satisfies PlatformOrganization

/** The session and workspace list `prefetchShell` seeds, under the keys their queries read. */
function seededSession(): DehydratedState {
  const client = new QueryClient()
  client.setQueryData(workspaceKeys.list('active', ORGANIZATION_ID), {
    workspaces: [],
    lastActiveWorkspaceId: null,
    pinnedWorkspaceIds: [],
    creationPolicy: null,
  })
  client.setQueryData(['session', 'detail'], {
    user: { id: 'viewer-narrow', email: 'narrow@example.com', name: 'Nia Narrow', image: null },
    session: {
      id: 'session-narrow',
      userId: 'viewer-narrow',
      activeOrganizationId: ORGANIZATION_ID,
    },
  })
  return dehydrate(client)
}

/** The cache the tree renders into, so the browser can start from an empty one, as it does. */
let renderCache: QueryClient | undefined
function RenderCache() {
  renderCache = useQueryClient()
  return null
}

/** The page's payload: on the server it is there; in the browser it arrives when released. */
let pagePayload = createDeferred<void>()
let pagePayloadArrived = true

function PagePayload({ children }: { children: ReactNode }) {
  if (!pagePayloadArrived) throw pagePayload.promise
  return children
}

/** `LiveShell` around the Search route, as the server component tree composes them. */
function SearchRoute({ shell }: { shell: DehydratedState }) {
  return (
    <LiveProviders
      organization={NARROW_MEMBER_SURFACE}
      navigation={{ destinations: [], settingsNavigation: [] }}
      dehydratedState={shell}
    >
      <RenderCache />
      <Suspense fallback={null}>
        <PagePayload>
          <ProductSession routePrefix={NARROW_MEMBER_SURFACE.routePrefix}>
            <SearchSurface />
          </ProductSession>
        </PagePayload>
      </Suspense>
    </LiveProviders>
  )
}

const roots: Root[] = []

beforeEach(() => {
  nextNavigationMockFns.mockUsePathname.mockReturnValue(`/o/${ORGANIZATION_ID}/search`)
  nextNavigationMockFns.mockUseSearchParams.mockReturnValue(new URLSearchParams('mode=search'))
  stubResizeObserver()
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith('/api/workspaces?')) {
        return jsonResponse({
          workspaces: [],
          lastActiveWorkspaceId: null,
          pinnedWorkspaceIds: [],
          creationPolicy: null,
        })
      }
      return new Promise<Response>(() => {})
    })
  )
  pagePayload = createDeferred<void>()
  pagePayloadArrived = true
  routeSearch = '?mode=search'
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  renderCache?.clear()
  document.body.replaceChildren()
  document.cookie = `${SEARCH_MODE_COOKIE}=; path=/; max-age=0`
})

it('hydrates the sidebar of a member with no workspaces as the server painted it', async () => {
  const shell = seededSession()
  const container = document.createElement('div')
  container.innerHTML = renderToString(<SearchRoute shell={shell} />)
  renderCache?.clear()
  document.body.append(container)
  const serverSidebar = container.querySelector('aside')

  const hydrationErrors: unknown[] = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  pagePayloadArrived = false
  await act(async () => {
    roots.push(
      hydrateRoot(container, <SearchRoute shell={shell} />, {
        onRecoverableError: (error) => hydrationErrors.push(error),
      })
    )
  })
  await act(flushMacrotask)

  await act(async () => {
    pagePayloadArrived = true
    pagePayload.resolve()
    await flushMacrotask()
  })

  expect(hydrationErrors).toEqual([])
  expect(container.querySelector('aside')).toBe(serverSidebar)
})

it('hydrates a bare Search URL as the server painted it, then applies the remembered mode', async () => {
  routeSearch = ''
  nextNavigationMockFns.mockUseSearchParams.mockReturnValue(new URLSearchParams())
  const shell = seededSession()
  const container = document.createElement('div')
  container.innerHTML = renderToString(<SearchRoute shell={shell} />)
  renderCache?.clear()
  document.body.append(container)
  const served = container.innerHTML
  document.cookie = `${SEARCH_MODE_COOKIE}=viewer-narrow:assistant; path=/`

  const hydrationErrors: unknown[] = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await act(async () => {
    roots.push(
      hydrateRoot(container, <SearchRoute shell={shell} />, {
        onRecoverableError: (error) => hydrationErrors.push(error),
      })
    )
  })
  await act(flushMacrotask)

  expect(hydrationErrors).toEqual([])
  expect(container.innerHTML).not.toBe(served)
})
