/**
 * @vitest-environment jsdom
 *
 * The live composer (Home's, here) renders on the server for a viewer the server already knows (it
 * seeds the session), but the viewer's draft lives in this browser's storage. Failure modes: the draft or its
 * uploads read during hydration, painting what the server never did (#418 and a client re-render);
 * the uploads, which a hydrating mount cannot start from, written back empty over the saved ones;
 * and a draft the legacy shared slot kept left stranded instead of moving into Home.
 */

import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { type DehydratedState, dehydrate, QueryClient, useQueryClient } from '@tanstack/react-query'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import { sessionKeys } from '@/hooks/queries/utils/session-keys'
import { useLiveComposer } from '@/platform/lib/data/chat-composer'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { LiveProviders } from '@/platform/lib/data/providers'
import { type DraftPayload, useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

const ORGANIZATION_ID = 'org-home'
const VIEWER_ID = 'viewer-home'
const DRAFTS_STORAGE = 'mothership-drafts:v1'
const HOME_KEY = `${VIEWER_ID}:organization:${ORGANIZATION_ID}:home`
const LEGACY_SHARED_KEY = `${VIEWER_ID}:organization:${ORGANIZATION_ID}:new`

const BUILDER_SURFACE = {
  organization: { id: ORGANIZATION_ID, name: 'Org', slug: 'org', logo: null, memberCount: 5 },
  routePrefix: `/o/${ORGANIZATION_ID}`,
  viewer: {
    role: 'member',
    isAdmin: false,
    canInviteMembers: false,
    canConnectSearchIntegrations: true,
    canUsePersonalApiKeys: false,
    canUseSearchMcp: false,
  },
  mothershipAvailable: true,
  searchAccess: { sourceMirrored: true, memberScoped: true },
  connectedAccountsAvailable: true,
  settingsFeatures: {
    billingEnabled: true,
    hasEnterprisePlan: false,
    governanceActive: false,
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
      accessControl: false,
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
    'platform-preview': false,
  },
  settingsSections: [],
} satisfies PlatformOrganization

const SAVED_DRAFT: DraftPayload = {
  text: 'Draft the renewal plan',
  fileAttachments: [
    {
      id: 'file-1',
      key: 'mothership/file-1/brief.pdf',
      filename: 'brief.pdf',
      media_type: 'application/pdf',
      size: 2048,
    },
  ],
}

/** The session entry `prefetchShell` seeds, under the key the session query reads. */
function seededSession(): DehydratedState {
  const client = new QueryClient()
  client.setQueryData(sessionKeys.detail(), {
    user: { id: VIEWER_ID, email: 'home@example.com', name: 'Hal Home', image: null },
    session: { id: 'session-home', userId: VIEWER_ID, activeOrganizationId: ORGANIZATION_ID },
  })
  return dehydrate(client)
}

let renderCache: QueryClient | undefined
function RenderCache() {
  renderCache = useQueryClient()
  return null
}

/** What the composer paints from its draft: the text and each attachment's name. */
function HomeDraft() {
  const { draft } = useLiveComposer({ draftKey: 'home', requestMode: 'agent' })
  return (
    <form>
      <textarea readOnly value={draft.text} />
      <ul>
        {draft.attachments.map((attachment) => (
          <li key={attachment.id}>{attachment.name}</li>
        ))}
      </ul>
    </form>
  )
}

function HomeRoute({ shell }: { shell: DehydratedState }) {
  return (
    <LiveProviders
      organization={BUILDER_SURFACE}
      navigation={{ destinations: [], settingsNavigation: [] }}
      dehydratedState={shell}
    >
      <RenderCache />
      <HomeDraft />
    </LiveProviders>
  )
}

/**
 * Server HTML from a store that has read no storage, as on the server; then this browser's storage
 * as the store reads it on load, and hydration over that HTML.
 */
async function hydrateHome(drafts: Record<string, DraftPayload>) {
  const shell = seededSession()
  useMothershipDraftsStore.setState({ drafts: {} })
  const container = document.createElement('div')
  container.innerHTML = renderToString(<HomeRoute shell={shell} />)
  renderCache?.clear()
  document.body.append(container)
  const served = container.textContent

  localStorage.setItem(DRAFTS_STORAGE, JSON.stringify({ state: { drafts }, version: 1 }))
  await useMothershipDraftsStore.persist.rehydrate()

  const hydrationErrors: unknown[] = []
  const savedUploads: number[] = []
  const unsubscribe = useMothershipDraftsStore.subscribe((state) => {
    savedUploads.push(state.drafts[HOME_KEY]?.fileAttachments?.length ?? 0)
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await act(async () => {
    roots.push(
      hydrateRoot(container, <HomeRoute shell={shell} />, {
        onRecoverableError: (error) => hydrationErrors.push(error),
      })
    )
  })
  await act(flushMacrotask)
  unsubscribe()
  return { container, served, hydrationErrors, savedUploads }
}

const roots: Root[] = []

beforeEach(() => {
  nextNavigationMockFns.mockUsePathname.mockReturnValue(`/o/${ORGANIZATION_ID}/home`)
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
    vi.fn(() => new Promise<Response>(() => {}))
  )
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  renderCache?.clear()
  document.body.replaceChildren()
  localStorage.clear()
})

it('hydrates without the saved draft, then shows it with its uploads still saved', async () => {
  const { container, served, hydrationErrors, savedUploads } = await hydrateHome({
    [HOME_KEY]: SAVED_DRAFT,
  })

  expect(hydrationErrors).toEqual([])
  expect(served).not.toContain('brief.pdf')
  expect(container.textContent).toContain('brief.pdf')
  expect(container.querySelector('textarea')?.value).toBe(SAVED_DRAFT.text)
  expect(
    useMothershipDraftsStore.getState().drafts[HOME_KEY]?.fileAttachments?.map(({ key }) => key)
  ).toEqual(['mothership/file-1/brief.pdf'])
  expect(savedUploads).not.toContain(0)
})

it('moves a draft the legacy shared slot kept into Home once hydrated', async () => {
  const { container, hydrationErrors } = await hydrateHome({ [LEGACY_SHARED_KEY]: SAVED_DRAFT })

  expect(hydrationErrors).toEqual([])
  expect(container.textContent).toContain('brief.pdf')
  const { drafts } = useMothershipDraftsStore.getState()
  expect(drafts[LEGACY_SHARED_KEY]).toBeUndefined()
  expect(drafts[HOME_KEY]?.text).toBe(SAVED_DRAFT.text)
})
