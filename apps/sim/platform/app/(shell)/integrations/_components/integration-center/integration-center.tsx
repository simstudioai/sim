'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import styles from '@/platform/app/(shell)/integrations/_components/integration-center/integration-center.module.css'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { ResourceDetails } from '@/platform/app/(shell)/integrations/_components/resource-details/resource-details'
import { ResourceEditor } from '@/platform/app/(shell)/integrations/_components/resource-editor/resource-editor'
import {
  AppGroup,
  ResourceGroup,
} from '@/platform/app/(shell)/integrations/_components/resource-list/resource-list'
import {
  ActionMenu,
  Button,
  ChoiceMenu,
  DestinationTabs,
  Modal,
  SearchField,
} from '@/platform/design-system/components'
import type {
  AppSummary,
  IntegrationCenterData,
  IntegrationResource,
  IntegrationTab,
} from '@/platform/lib/integrations/center-model'
import {
  CENTER_TABS,
  centerParams,
  serializeCenter,
} from '@/platform/lib/integrations/center-navigation'

interface ResourceLibrary {
  data: IntegrationCenterData
  save: (resource: IntegrationResource) => void
  remove: (id: string) => void
}

interface IntegrationCenterProps {
  apps: readonly AppSummary[]
  credentials?: readonly AppSummary[]
  library?: ResourceLibrary
  settled?: boolean
}

const RESOURCE_KIND = { skills: 'skill', mcps: 'mcp', credentials: 'credential' } as const
const CREATE_LABEL = {
  skills: 'Create skill',
  mcps: 'Connect MCP',
  credentials: 'Create credential',
} as const

/** The same directory receives authorized live summaries or server-gated example data. */
export function IntegrationCenter({
  apps,
  credentials = [],
  library,
  settled = true,
}: IntegrationCenterProps) {
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [view, setView] = useQueryStates(centerParams, { history: 'replace', shallow: true })
  const [creating, setCreating] = useState<IntegrationResource['kind'] | null>(null)
  const [deleting, setDeleting] = useState<IntegrationResource | null>(null)
  const tabs = library
    ? CENTER_TABS
    : CENTER_TABS.filter((tab) => tab.id === 'apps' || tab.id === 'credentials')
  const current: IntegrationTab = tabs.some((tab) => tab.id === view.tab) ? view.tab : 'apps'
  const base = `${pathname}?${search.toString()}`
  const destinations = tabs.map((tab) => ({
    label: tab.label,
    href: serializeCenter(base, {
      tab: tab.id,
      q: null,
      category: null,
      connection: null,
      scope: null,
      resource: null,
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
  const editing = library?.data.resources.find((resource) => resource.id === view.resource)
  const empty =
    current === 'apps'
      ? !visibleApps.length
      : !resources.length && !(current === 'credentials' && credentialLinks.length)

  async function open(resource: IntegrationResource) {
    await setView(view)
    router.push(serializeCenter(base, { ...view, resource: resource.id }), { scroll: false })
  }

  async function navigate(href: string) {
    // Flush the directory's pending URL update before it becomes a browser-history entry.
    await setView(view)
    router.push(href)
  }

  return (
    <div className={styles.center}>
      <div className={styles.toolbar}>
        <DestinationTabs
          label='Integration categories'
          destinations={destinations}
          currentHref={currentHref}
        />
        <IntegrationControls
          leading={
            <SearchField
              variant='quiet'
              label={`Search ${current}`}
              placeholder={`Search ${current === 'mcps' ? 'MCPs' : current}…`}
              value={view.q}
              onValueChange={(q) => void setView({ q })}
            />
          }
        >
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
          {current !== 'apps' && library && (
            <Button
              variant='secondary'
              size='compact'
              icon='I074'
              onClick={() => setCreating(RESOURCE_KIND[current])}
            >
              {CREATE_LABEL[current]}
            </Button>
          )}
        </IntegrationControls>
      </div>
      <div className={styles.groups}>
        {current === 'apps' ? (
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
                onDelete={setDeleting}
              />
            ))}
          </>
        )}
        {settled && empty && (
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
      {editing?.canEdit === false ? (
        <ResourceDetails resource={editing} onClose={() => void setView({ resource: null })} />
      ) : (
        library &&
        (creating || editing) && (
          <ResourceEditor
            key={editing?.id ?? creating}
            resource={editing}
            kind={editing?.kind ?? creating ?? 'skill'}
            data={library.data}
            onClose={() => {
              setCreating(null)
              void setView({ resource: null })
            }}
            onSave={library.save}
          />
        )
      )}
      {deleting && library && (
        <Modal
          open
          title={`Delete ${deleting.name}?`}
          description='This removes it from your integrations.'
          confirmLabel='Delete'
          destructive
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
          onConfirm={() => {
            library.remove(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
