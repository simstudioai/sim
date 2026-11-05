'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ActionRow,
  FieldStack,
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  type SearchSource,
  type SourceSettingsData,
  sourceDescription,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import { SlackAppSettings } from '@/platform/app/(shell)/settings/_components/sections/integrations/slack-app-settings'
import {
  ConnectionDetails,
  ProviderConnections,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/source-connections'
import { SourceRow } from '@/platform/app/(shell)/settings/_components/sections/integrations/source-row'
import { SecretSettings } from '@/platform/app/(shell)/settings/_components/sections/integrations/source-secrets'
import {
  ActionMenu,
  ActivityRow,
  Button,
  EmptyState,
  Icon,
  Modal,
  SearchField,
  SegmentedControl,
  Select,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { platformHref } from '@/platform/design-system/navigation'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'

type Editor = { type: 'add' | 'secrets' | 'slack' } | { type: 'policy' | 'remove'; id: string }
interface SourcesViewProps {
  initial: SourceSettingsData
  subpath: readonly string[]
}

export function SourcesView({ initial, subpath }: SourcesViewProps) {
  const { data, update } = useSettingsFixtureDraft('integrations', initial)
  const search = useSearchParams()
  const router = useRouter()
  const href = (suffix = '') => platformHref(`/settings/integrations${suffix}`, search)
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<Editor | null>(
    search.get('connectedAccounts') === 'slack' ? { type: 'slack' } : null
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
    if (source.id === 'gitlab') router.push(href('/providers/gitlab'))
    setEditor(source.id === 'slack' ? { type: 'slack' } : null)
  }
  const [kind, id] = subpath
  if (kind === 'providers') {
    const source = data.sources.find((entry) => entry.id === id)
    return source ? (
      <ProviderConnections source={source} data={data} update={update} href={href} />
    ) : (
      <EmptyState title='Source unavailable' />
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
      <EmptyState title='Connection unavailable' />
    )
  }
  if (kind === 'secrets')
    return data.secretMode === 'organization' ? (
      <SecretSettings data={data} href={href()} update={update} />
    ) : (
      <EmptyState title='Organization secrets are unavailable' />
    )
  const needle = query.trim().toLowerCase()
  const visible = data.sources.filter(
    (source) => source.approved && source.name.toLowerCase().includes(needle)
  )
  const showSecrets = data.secretMode !== null && 'generic secrets'.includes(needle)
  const available = data.sources.filter((source) => !source.approved)
  const apps = data.assistantApps.filter(
    (app) => app.name.toLowerCase().includes(needle) || app.account?.toLowerCase().includes(needle)
  )
  const policy = editor?.type === 'policy' && data.sources.find((source) => source.id === editor.id)
  const removing =
    editor?.type === 'remove' &&
    (editor.id === 'secrets'
      ? 'Generic Secrets'
      : data.sources.find((source) => source.id === editor.id)?.name)
  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search sources'
            placeholder='Search sources…'
            onValueChange={setQuery}
          />
        }
      />
      {apps.length > 0 && (
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
                  render={<Link href={platformHref(`/integrations/${app.id}`, search)} />}
                >
                  {app.account ? 'Manage account' : 'Connect'}
                </Button>
              </SettingsRow>
            ))}
          {apps.some((app) => !app.approved) && (
            <SettingsRow label='Add Assistant app'>
              <Select
                label='Add Assistant app'
                options={[
                  { value: '', label: 'Add app' },
                  ...apps
                    .filter((app) => !app.approved)
                    .map((app) => ({ value: app.id, label: app.name })),
                ]}
                value=''
                onValueChange={(id) =>
                  update((current) => ({
                    ...current,
                    assistantApps: current.assistantApps.map((app) =>
                      app.id === id ? { ...app, approved: true } : app
                    ),
                  }))
                }
              />
            </SettingsRow>
          )}
        </SettingsSection>
      )}
      <SettingsSection title='Search sources'>
        {visible.map((source) => (
          <SourceRow key={source.id} source={source}>
            <ActionRow>
              {source.mode === 'service_account' && (
                <Button size='compact' render={<Link href={href(`/providers/${source.id}`)} />}>
                  {source.id === 'github'
                    ? 'Repositories'
                    : source.id === 'gitlab'
                      ? 'Projects'
                      : 'Connections'}
                </Button>
              )}
              {source.id === 'slack' && (
                <Button size='compact' onClick={() => setEditor({ type: 'slack' })}>
                  {data.slackApp ? 'Slack app' : 'Verify permissions'}
                </Button>
              )}
              {source.setupRequired && (
                <Button
                  size='compact'
                  onClick={() => saveSource({ ...source, setupRequired: false })}
                >
                  Set up accounts
                </Button>
              )}
              {source.supportedModes.length > 1 && (
                <Button size='compact' onClick={() => setEditor({ type: 'policy', id: source.id })}>
                  Configure
                </Button>
              )}
              <ActionMenu
                label={`${source.name} source actions`}
                actions={[
                  {
                    id: 'remove',
                    label: 'Remove source',
                    destructive: true,
                    onSelect: () => setEditor({ type: 'remove', id: source.id }),
                  },
                ]}
              />
            </ActionRow>
          </SourceRow>
        ))}
        {showSecrets && (
          <SettingsRow
            label='Generic Secrets'
            leading={<Icon name='I070' />}
            description={data.secretMode === 'organization' ? 'Organization' : 'Member'}
          >
            <ActionRow>
              {data.secretMode === 'organization' && (
                <Button size='compact' render={<Link href={href('/secrets')} />}>
                  Secrets
                </Button>
              )}
              <Button size='compact' onClick={() => setEditor({ type: 'secrets' })}>
                Configure
              </Button>
              <ActionMenu
                label='Generic Secrets source actions'
                actions={[
                  {
                    id: 'remove',
                    label: 'Remove source',
                    destructive: true,
                    onSelect: () => setEditor({ type: 'remove', id: 'secrets' }),
                  },
                ]}
              />
            </ActionRow>
          </SettingsRow>
        )}
        {!visible.length && !showSecrets && (
          <EmptyState title={needle ? 'No matching sources' : 'No sources yet'} />
        )}
        <SettingsRow label='Add source'>
          <Button
            size='compact'
            disabled={!available.length && !!data.secretMode}
            onClick={() => setEditor({ type: 'add' })}
            icon='I074'
          >
            Add source
          </Button>
        </SettingsRow>
      </SettingsSection>
      {editor?.type === 'add' && (
        <Modal
          open
          title='Add source'
          confirmLabel='Done'
          onOpenChange={(open) => !open && setEditor(null)}
        >
          <ResourceList>
            {available.map((source) => (
              <ActivityRow
                key={source.id}
                title={source.name}
                leading={<Icon providerId={source.id} />}
                detail={
                  source.supportedModes.length === 2
                    ? 'Service account or member accounts'
                    : sourceDescription(source)
                }
                onOpen={() => addSource(source)}
              />
            ))}
            {!data.secretMode && (
              <ActivityRow
                title='Generic Secrets'
                leading={<Icon name='I070' />}
                detail='Organization or member secrets'
                onOpen={() => setEditor({ type: 'secrets' })}
              />
            )}
          </ResourceList>
        </Modal>
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
      {removing && editor?.type === 'remove' && (
        <Modal
          open
          variant='confirm'
          destructive
          title={`Remove ${removing} source?`}
          description='Members will lose access to this source in Search.'
          confirmLabel='Remove source'
          onOpenChange={(open) => !open && setEditor(null)}
          onConfirm={() =>
            update((current) =>
              editor.id === 'secrets'
                ? { ...current, secretMode: null }
                : {
                    ...current,
                    sources: current.sources.map((item) =>
                      item.id === editor.id ? { ...item, approved: false } : item
                    ),
                  }
            )
          }
        />
      )}
    </SectionStack>
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
                : source.id === 'github'
                  ? 'GitHub App'
                  : 'Service account',
          }))}
          value={mode}
          onSelect={setMode}
        />
        {managed && source.id !== 'github' && !!connections.length && (
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
            {source.id === 'github' ? 'Manage GitHub repositories' : 'Manage connections'}
          </Button>
        )}
      </FieldStack>
    </Modal>
  )
}
