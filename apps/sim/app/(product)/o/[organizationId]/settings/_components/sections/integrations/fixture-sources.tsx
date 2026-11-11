'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { Select } from '@sim/emcn/picker/select'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { FieldStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { AddSourceModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/add-source-modal'
import {
  GENERIC_SECRETS_NAME,
  GENERIC_SECRETS_SOURCE_TYPE,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/generic-secrets'
import {
  type SearchSource,
  type SourceSettingsData,
  sourceDescription,
  sourceTypeMeta,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/model'
import { SlackAppSettings } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/slack-app-settings'
import {
  ConnectionDetails,
  ProviderConnections,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/source-connections'
import { SecretSettings } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/source-secrets'
import {
  type SourceListRow,
  type SourceRowAction,
  SourcesList,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/sources-list'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'
import { usePlatformHref } from '@/platform/lib/platform-href'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

type Editor = { type: 'add' | 'secrets' | 'slack' } | { type: 'policy'; id: string }

interface FixtureSourcesProps {
  initial: SourceSettingsData
  subpath: readonly string[]
}

function Unavailable({ title }: { title: string }) {
  return (
    <>
      <SettingsPageHeader />
      <EmptyState title={title} />
    </>
  )
}

/**
 * The Search sources page on example data: the same `SourcesList` the live page renders, with the
 * fixture draft standing in for the server and the fixture editors for its dialogs.
 */
export function FixtureSources({ initial, subpath }: FixtureSourcesProps) {
  const { data, update } = useSettingsFixtureDraft('integrations', initial)
  const params = useSearchParams()
  const hrefFor = usePlatformHref()
  const scope = useSurfaceScope()
  const router = useRouter()
  const href = (suffix = '') => hrefFor(surfaceHref(scope, `/settings/integrations${suffix}`))
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<Editor | null>(
    params.get('connectedAccounts') === 'slack' ? { type: 'slack' } : null
  )
  function saveSource(source: SearchSource) {
    update((current) => ({
      ...current,
      sources: current.sources.map((item) => (item.id === source.id ? source : item)),
    }))
  }
  function addSource(source: SearchSource) {
    if (source.supportedModes.length > 1) {
      setEditor({ type: 'policy', id: source.id })
      return
    }
    saveSource({ ...source, approved: true })
    const meta = sourceTypeMeta(source.id)
    if (meta.serviceAccountOnly) router.push(href(`/providers/${source.id}`))
    setEditor(meta.slackApp ? { type: 'slack' } : null)
  }
  const [kind, id] = subpath
  if (kind === 'providers') {
    const source = data.sources.find((entry) => entry.id === id)
    return source ? (
      <ProviderConnections source={source} data={data} update={update} href={href} />
    ) : (
      <Unavailable title='Source unavailable' />
    )
  }
  if (kind === 'sources') {
    const connection = data.connections.find((entry) => entry.id === id)
    const source = data.sources.find((entry) => entry.id === connection?.provider)
    return connection && source ? (
      <ConnectionDetails
        key={connection.id}
        connection={connection}
        source={source}
        href={href}
        update={update}
      />
    ) : (
      <Unavailable title='Connection unavailable' />
    )
  }
  if (kind === 'secrets')
    return data.secretMode === 'organization' ? (
      <SecretSettings data={data} href={href()} update={update} />
    ) : (
      <Unavailable title='Organization secrets are unavailable' />
    )

  const needle = query.trim().toLowerCase()
  const visible = data.sources.filter(
    (source) => source.approved && source.name.toLowerCase().includes(needle)
  )
  const showSecrets =
    data.secretMode !== null && GENERIC_SECRETS_NAME.toLowerCase().includes(needle)
  const available = data.sources.filter((source) => !source.approved)
  const apps = data.assistantApps.filter(
    (app) => app.name.toLowerCase().includes(needle) || app.account?.toLowerCase().includes(needle)
  )
  const policy = editor?.type === 'policy' && data.sources.find((source) => source.id === editor.id)

  const sourceRow = (source: SearchSource): SourceListRow => {
    const meta = sourceTypeMeta(source.id)
    const actions: SourceRowAction[] = [
      ...(meta.slackApp && !data.slackApp
        ? [{ label: 'Verify permissions', onSelect: () => setEditor({ type: 'slack' }) }]
        : []),
      ...(source.setupRequired
        ? [
            {
              label: 'Set up accounts',
              onSelect: () => saveSource({ ...source, setupRequired: false }),
            },
          ]
        : []),
      ...(source.mode === 'service_account'
        ? [{ label: meta.connections, href: href(`/providers/${source.id}`) }]
        : []),
      ...(meta.slackApp && data.slackApp
        ? [{ label: 'Slack app', onSelect: () => setEditor({ type: 'slack' }) }]
        : []),
      ...(source.supportedModes.length > 1
        ? [{ label: 'Configure', onSelect: () => setEditor({ type: 'policy', id: source.id }) }]
        : []),
    ]
    const [primary, ...more] = actions
    return {
      id: source.id,
      name: source.name,
      leading: <Icon providerId={source.id} />,
      description: sourceDescription(source),
      primary,
      more,
      removeConsequence: 'Members can no longer search this source',
      onRemove: () =>
        update((current) => ({
          ...current,
          sources: current.sources.map((item) =>
            item.id === source.id ? { ...item, approved: false } : item
          ),
        })),
    }
  }
  const configureSecrets = { label: 'Configure', onSelect: () => setEditor({ type: 'secrets' }) }
  const rows: SourceListRow[] = [
    ...visible.map(sourceRow),
    ...(showSecrets
      ? [
          {
            id: GENERIC_SECRETS_SOURCE_TYPE,
            name: GENERIC_SECRETS_NAME,
            leading: <Icon name='I070' />,
            description: data.secretMode === 'organization' ? 'Organization' : 'Member',
            primary:
              data.secretMode === 'organization'
                ? { label: 'Secrets', href: href('/secrets') }
                : configureSecrets,
            more: data.secretMode === 'organization' ? [configureSecrets] : [],
            removeConsequence: 'Its organization and member secrets are deleted',
            onRemove: () => update((current) => ({ ...current, secretMode: null })),
          },
        ]
      : []),
  ]
  const addable = [
    ...available.map((source) => ({
      type: source.id,
      name: source.name,
      access: {
        admin: source.supportedModes.includes('service_account'),
        members: source.supportedModes.includes('member'),
      },
    })),
    ...(data.secretMode
      ? []
      : [
          {
            type: GENERIC_SECRETS_SOURCE_TYPE,
            name: GENERIC_SECRETS_NAME,
            access: { admin: true, members: true },
          },
        ]),
  ]

  return (
    <SourcesList
      search={query}
      onSearchChange={setQuery}
      assistantApps={
        apps.length > 0 && (
          <SettingsSection title='Assistant apps'>
            {apps
              .filter((app) => app.approved)
              .map((app) => (
                <SettingsRow
                  key={app.id}
                  label={app.name}
                  leading={<Icon providerId={app.id} />}
                  description={app.account ?? 'No account connected'}
                >
                  <Button
                    size='compact'
                    render={<Link href={hrefFor(surfaceHref(scope, `/integrations/${app.id}`))} />}
                  >
                    {app.account ? 'Manage account' : 'Connect'}
                  </Button>
                </SettingsRow>
              ))}
            {apps.some((app) => !app.approved) && (
              <SettingsRow
                label='Add Assistant app'
                description='Approve an app members connect their own accounts to'
              >
                <ActionMenu
                  label='Add app'
                  triggerSize='compact'
                  icon={null}
                  actions={apps
                    .filter((app) => !app.approved)
                    .map((app) => ({
                      id: app.id,
                      label: app.name,
                      onSelect: () =>
                        update((current) => ({
                          ...current,
                          assistantApps: current.assistantApps.map((entry) =>
                            entry.id === app.id ? { ...entry, approved: true } : entry
                          ),
                        })),
                    }))}
                />
              </SettingsRow>
            )}
          </SettingsSection>
        )
      }
      rows={rows}
      searchable={data.sources.some((source) => source.approved) || data.secretMode !== null}
      addDisabled={addable.length === 0}
      onAdd={() => setEditor({ type: 'add' })}
    >
      {editor?.type === 'add' && (
        <AddSourceModal
          sources={addable}
          descriptions={Object.fromEntries([
            ...available.map((source) => [
              source.id,
              source.supportedModes.length === 2
                ? 'Service account or member accounts'
                : sourceDescription(source),
            ]),
            [GENERIC_SECRETS_SOURCE_TYPE, 'Organization or member secrets'],
          ])}
          pending={false}
          ready
          feedback={null}
          onClose={() => setEditor(null)}
          onSelect={(type) => {
            const source = available.find((entry) => entry.id === type)
            if (source) addSource(source)
            else setEditor({ type: 'secrets' })
          }}
        />
      )}
      {policy && (
        <SourcePolicy
          key={policy.id}
          source={policy}
          data={data}
          href={href(`/providers/${policy.id}`)}
          close={() => setEditor(null)}
          save={saveSource}
        />
      )}
      {editor?.type === 'secrets' && (
        <SecretMode
          mode={data.secretMode ?? 'organization'}
          close={() => setEditor(null)}
          save={(mode) => update((current) => ({ ...current, secretMode: mode }))}
        />
      )}
      {editor?.type === 'slack' && (
        <SlackAppSettings
          value={data.slackApp}
          close={() => setEditor(null)}
          save={(app) => update((current) => ({ ...current, slackApp: app }))}
        />
      )}
    </SourcesList>
  )
}

function SecretMode({
  mode,
  save,
  close,
}: {
  mode: 'organization' | 'member'
  save: (mode: 'organization' | 'member') => void
  close: () => void
}) {
  const [draft, setDraft] = useState(mode)
  return (
    <Modal
      open
      title='Generic Secrets'
      confirmLabel='Save'
      onOpenChange={(open) => !open && close()}
      onConfirm={() => save(draft)}
    >
      <SegmentedControl
        label='Mode'
        options={[
          { value: 'organization', label: 'Organization' },
          { value: 'member', label: 'Member' },
        ]}
        value={draft}
        onSelect={setDraft}
      />
    </Modal>
  )
}

function SourcePolicy({
  source,
  data,
  href,
  save,
  close,
}: {
  source: SearchSource
  data: SourceSettingsData
  href: string
  save: (value: SearchSource) => void
  close: () => void
}) {
  const [mode, setMode] = useState(source.approved ? source.mode : 'service_account')
  const [connectionId, setConnection] = useState(source.connectionId ?? '')
  const managed = mode === 'service_account'
  const connections = data.connections.filter((item) => item.provider === source.id)
  return (
    <Modal
      open
      title={source.name}
      confirmLabel='Save'
      onOpenChange={(open) => !open && close()}
      onConfirm={() =>
        save({
          ...source,
          approved: true,
          mode,
          connectionId: managed ? connectionId || undefined : undefined,
        })
      }
    >
      <FieldStack>
        <SegmentedControl
          label='Account mode'
          options={source.supportedModes.map((value) => ({
            value,
            label:
              value === 'member'
                ? 'Member accounts'
                : sourceTypeMeta(source.id).appInstallation
                  ? 'GitHub App'
                  : 'Service account',
          }))}
          value={mode}
          onSelect={setMode}
        />
        {managed && !sourceTypeMeta(source.id).appInstallation && !!connections.length && (
          <Select
            label='Service account connection'
            options={[
              { value: '', label: 'Select a connection' },
              ...connections.map(({ id, name }) => ({ value: id, label: name })),
            ]}
            value={connectionId}
            onValueChange={setConnection}
          />
        )}
        {managed && source.approved && (
          <Button render={<Link href={href} />}>
            {`Manage ${sourceTypeMeta(source.id).connections.toLowerCase()}`}
          </Button>
        )}
      </FieldStack>
    </Modal>
  )
}
