'use client'

import { type ReactNode, useState, useTransition } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchField } from '@sim/emcn/search-field'
import { DestinationTabs } from '@sim/emcn-platform/destination-tabs'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { DirectoryBack } from '@/app/(product)/_components/resource-directory/resource-directory'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/integration-center/integration-center.module.css'
import { ManualCredentialDetail } from '@/app/(product)/o/[organizationId]/integrations/_components/manual-credential-detail/manual-credential-detail'
import { ResourceDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/resource-details/resource-details'
import { ResourceEditor } from '@/app/(product)/o/[organizationId]/integrations/_components/resource-editor/resource-editor'
import {
  AppGroup,
  ResourceGroup,
} from '@/app/(product)/o/[organizationId]/integrations/_components/resource-list/resource-list'
import type {
  AppSummary,
  IntegrationCenterData,
  IntegrationResource,
  IntegrationTab,
} from '@/platform/lib/integrations/center-model'
import {
  CENTER_TABS,
  integrationsPageParams,
  serializeCenter,
  serializeIntegrationsPage,
} from '@/platform/lib/integrations/center-navigation'
import { clearCredentialView } from '@/platform/lib/integrations/credential-navigation'
import { platformHref } from '@/platform/lib/navigation'

interface ResourceLibrary {
  data: IntegrationCenterData
  save: (resource: IntegrationResource) => void
  remove: (id: string) => void
  leave: (id: string) => void
}

/** A tab whose rows live data supplies, such as a workspace's skills or MCP servers. */
export interface LiveTab {
  /** A choice of its own beside the page's, where the tab has one. */
  filter?: ReactNode
  /** Create and import, ending the control bar. */
  actions: ReactNode
  content: ReactNode
  empty: boolean
  settled: boolean
}

interface IntegrationCenterProps {
  /**
   * The directory's page heading. A resource opened in place replaces the directory and this heading
   * in the same render, so the two never disagree about which view the URL shows.
   */
  heading?: ReactNode
  apps: readonly AppSummary[]
  credentials?: readonly AppSummary[]
  library?: ResourceLibrary
  skills?: LiveTab
  mcps?: LiveTab
  /** Where a credential is created on live data, which the Credentials tab's Create opens. */
  createCredentialHref?: string
  settled?: boolean
  /** The choice every tab lists within, such as the workspace whose credentials and skills it shows. */
  scopeFilter?: ReactNode
}

const RESOURCE_KIND = { skills: 'skill', mcps: 'mcp', credentials: 'credential' } as const
const CREATE_LABEL = {
  skills: 'Create skill',
  mcps: 'Connect MCP',
  credentials: 'Create credential',
} as const

/** The same directory receives authorized live summaries or server-gated example data. */
export function IntegrationCenter({
  heading,
  apps,
  credentials = [],
  library,
  skills,
  mcps,
  createCredentialHref,
  settled = true,
  scopeFilter,
}: IntegrationCenterProps) {
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [view, setView] = useQueryStates(integrationsPageParams, {
    history: 'replace',
    shallow: true,
  })
  const [isOpening, startOpening] = useTransition()
  const [creating, setCreating] = useState<IntegrationResource['kind'] | null>(null)
  const tabs = library
    ? CENTER_TABS
    : CENTER_TABS.filter(
        (tab) =>
          tab.id === 'apps' ||
          tab.id === 'credentials' ||
          (tab.id === 'skills' && skills) ||
          (tab.id === 'mcps' && mcps)
      )
  const current: IntegrationTab = tabs.some((tab) => tab.id === view.tab) ? view.tab : 'apps'
  const base = platformHref(pathname, search)
  const linkTo = (change: Partial<typeof view>) =>
    serializeIntegrationsPage(base, { ...view, ...change })
  const destinations = tabs.map((tab) => ({
    label: tab.label,
    href: linkTo({
      tab: tab.id,
      q: null,
      category: null,
      connection: null,
      scope: null,
      resource: null,
      resourceTab: null,
    }),
  }))
  const currentHref = destinations[tabs.findIndex((tab) => tab.id === current)]?.href ?? pathname
  const term = view.q.trim().toLowerCase()
  const compare = (a: { name: string }, b: { name: string }) =>
    (view.order === 'asc' ? 1 : -1) * a.name.localeCompare(b.name)
  const categories = [...new Set(apps.map((app) => app.category))].sort()
  const visibleApps = apps
    .filter(
      (app) =>
        (view.category === 'all' || app.category === view.category) &&
        (view.connection === 'all' || app.connected === (view.connection === 'connected')) &&
        `${app.name} ${app.description} ${app.category} ${app.searchable ?? ''}`
          .toLowerCase()
          .includes(term)
    )
    .sort(compare)
    .map((app) => ({ ...app, href: serializeCenter(app.href, { ...view, resource: null }) }))
  const resources = (library?.data.resources ?? [])
    .filter(
      (resource) =>
        current !== 'apps' &&
        resource.kind === RESOURCE_KIND[current] &&
        (view.scope === 'all' || resource.scope === view.scope) &&
        `${resource.name} ${resource.description} ${resource.owner.name}`
          .toLowerCase()
          .includes(term)
    )
    .sort(compare)
  const credentialLinks = credentials
    .filter(
      (item) =>
        (view.scope === 'all' || item.scope === view.scope) &&
        `${item.name} ${item.description}`.toLowerCase().includes(term)
    )
    .sort(compare)
    .map((app) => ({ ...app, href: serializeCenter(app.href, { ...view, resource: null }) }))
  const editing = isOpening
    ? undefined
    : library?.data.resources.find((resource) => resource.id === view.resource)
  const live = library
    ? undefined
    : current === 'skills'
      ? skills
      : current === 'mcps'
        ? mcps
        : undefined
  const empty = live
    ? live.empty
    : current === 'apps'
      ? !visibleApps.length
      : !resources.length && !(current === 'credentials' && credentialLinks.length)

  function open(resource: IntegrationResource) {
    startOpening(async () => {
      await setView({})
      await setView(
        { ...clearCredentialView, resource: resource.id, resourceTab: null },
        { history: 'push', scroll: false }
      )
    })
  }

  async function navigate(href: string) {
    // Await pending filters without adding another shallow navigation before the route change.
    await setView({})
    router.push(href)
  }

  if (editing?.kind === 'credential' && library)
    return (
      <>
        <DirectoryBack
          href={linkTo({ ...clearCredentialView, resource: null })}
          label='Back to Credentials'
          onNavigate={(event) => {
            event.preventDefault()
            void setView(
              { ...clearCredentialView, resource: null },
              { history: 'push', scroll: false }
            )
          }}
        />
        <ManualCredentialDetail
          key={editing.id}
          resource={editing}
          data={library.data}
          appName={apps.find((app) => app.id === editing.appId)?.name}
          onSave={library.save}
          onRemove={() => {
            library.remove(editing.id)
            void setView({ ...clearCredentialView, resource: null })
          }}
          onLeave={() => {
            library.leave(editing.id)
            void setView({ ...clearCredentialView, resource: null })
          }}
        />
      </>
    )

  if (
    library &&
    (current === 'skills' || current === 'mcps') &&
    (view.resource === 'new' || (editing && editing.kind !== 'credential'))
  ) {
    const resource = editing?.kind !== 'credential' ? editing : undefined
    const kind = resource?.kind ?? (current === 'skills' ? 'skill' : 'mcp')
    const close = () =>
      void setView({ resource: null, resourceTab: null }, { history: 'push', scroll: false })
    return (
      <ResourceDetails
        key={resource?.id ?? `new-${kind}`}
        kind={kind}
        resource={resource}
        data={library.data}
        backHref={linkTo({ resource: null, resourceTab: null })}
        onBack={close}
        onSave={(next) => {
          library.save(next)
          if (!resource) void setView({ resource: next.id }, { history: 'replace', scroll: false })
        }}
        onDelete={library.remove}
      />
    )
  }

  return (
    <>
      {heading}
      <div className={styles.center}>
        <div className={styles.toolbar}>
          <DestinationTabs
            label='Integration categories'
            destinations={destinations}
            currentHref={currentHref}
          />
          <ControlBar
            search={
              <SearchField
                variant='quiet'
                label={`Search ${current}`}
                placeholder={`Search ${current === 'mcps' ? 'MCPs' : current}…`}
                value={view.q}
                onValueChange={(q) => void setView({ q })}
              />
            }
          >
            {scopeFilter}
            {current === 'apps' ? (
              <ChoiceMenu
                label='App filter'
                value={view.category === 'all' ? view.connection : `category:${view.category}`}
                options={[
                  { label: 'All', value: 'all' },
                  { label: 'Connected', value: 'connected' },
                  { label: 'Available', value: 'available' },
                  {
                    label: 'Categories',
                    options: categories.map((category) => ({
                      label: category,
                      value: `category:${category}`,
                    })),
                  },
                ]}
                onValueChange={(value) => {
                  if (value.startsWith('category:')) {
                    void setView({ category: value.slice(9), connection: 'all' })
                  } else if (value === 'all' || value === 'connected' || value === 'available') {
                    void setView({ category: 'all', connection: value })
                  }
                }}
              />
            ) : live ? (
              live.filter
            ) : (
              <ChoiceMenu
                label='Category'
                value={view.scope}
                options={[
                  { label: 'All', value: 'all' },
                  { label: 'Shared', value: 'shared' },
                  { label: 'Personal', value: 'personal' },
                ]}
                onValueChange={(scope) => {
                  if (scope === 'all' || scope === 'shared' || scope === 'personal')
                    void setView({ scope })
                }}
              />
            )}
            <ActionMenu
              label='Sort integrations'
              icon='I050'
              tooltip
              actions={[
                {
                  id: 'asc',
                  label: 'Name A–Z',
                  checked: view.order === 'asc',
                  onSelect: () => void setView({ order: 'asc' }),
                },
                {
                  id: 'desc',
                  label: 'Name Z–A',
                  checked: view.order === 'desc',
                  onSelect: () => void setView({ order: 'desc' }),
                },
              ]}
            />
            {live?.actions}
            {current === 'credentials' && !library && createCredentialHref && (
              <Button
                variant='secondary'
                size='compact'
                icon='I074'
                render={<Link href={createCredentialHref} />}
              >
                Create credential
              </Button>
            )}
            {current !== 'apps' && library && (
              <Button
                variant='secondary'
                size='compact'
                icon='I074'
                onClick={() => {
                  if (current === 'credentials') setCreating('credential')
                  else
                    void setView(
                      { resource: 'new', resourceTab: null },
                      { history: 'push', scroll: false }
                    )
                }}
              >
                {CREATE_LABEL[current]}
              </Button>
            )}
          </ControlBar>
        </div>
        <div className={styles.groups}>
          {live ? (
            live.content
          ) : current === 'apps' ? (
            <>
              <AppGroup
                title='Connected'
                apps={visibleApps.filter((app) => app.connected)}
                onNavigate={navigate}
              />
              <AppGroup
                title='Available'
                apps={visibleApps.filter((app) => !app.connected)}
                onNavigate={navigate}
              />
            </>
          ) : (
            <>
              {(['shared', 'personal'] as const).map((scope) => (
                <ResourceGroup
                  key={scope}
                  title={scope === 'shared' ? 'Shared' : 'Personal'}
                  resources={resources.filter((resource) => resource.scope === scope)}
                  links={
                    current === 'credentials'
                      ? credentialLinks.filter((item) => item.scope === scope)
                      : []
                  }
                  order={view.order}
                  onNavigate={navigate}
                  onOpen={open}
                  resourceHref={(resource) =>
                    linkTo({ ...clearCredentialView, resource: resource.id, resourceTab: null })
                  }
                />
              ))}
            </>
          )}
          {(live ? live.settled : settled) && empty && (
            <section className={styles.empty} aria-label='Search results'>
              <h2 data-type='T059'>
                {term ? 'No results found' : `No ${current === 'mcps' ? 'MCPs' : current} yet`}
              </h2>
              <p data-type='T050'>
                {term
                  ? 'Try a different name or clear your filters.'
                  : current === 'apps'
                    ? 'Apps available to your organization appear here.'
                    : 'Your personal and shared connections appear here.'}
              </p>
            </section>
          )}
        </div>
        {creating === 'credential' && library && (
          <ResourceEditor
            kind='credential'
            data={library.data}
            apps={apps}
            onClose={() => setCreating(null)}
            onSave={library.save}
          />
        )}
      </div>
    </>
  )
}
