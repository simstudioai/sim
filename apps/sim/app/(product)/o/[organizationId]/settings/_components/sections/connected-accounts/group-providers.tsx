'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { parseAsString, useQueryState } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import {
  ActionRow,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type {
  CredentialGroupsData,
  CredentialProvider,
  DatabricksConfiguration,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/model'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface GroupProvidersProps {
  databricks?: DatabricksConfiguration
  onConfigure: (config?: DatabricksConfiguration) => void
  data: CredentialGroupsData
  editable: boolean
  onChange: (keys: string[]) => void
}

interface DatabricksFormProps {
  configuration?: DatabricksConfiguration
  onSave: (value: DatabricksConfiguration) => void
  onClose: () => void
}

function DatabricksForm({ configuration, onSave, onClose }: DatabricksFormProps) {
  const [name, setName] = useState(configuration?.name ?? 'Databricks')
  const [url, setUrl] = useState(configuration?.url ?? '')
  const [clientId, setClientId] = useState(configuration?.clientId ?? '')
  const [secret, setSecret] = useState('')
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={configuration ? 'Configure Databricks' : 'Add Databricks'}
      confirmLabel={configuration ? 'Save' : 'Add'}
      confirmDisabled={!name.trim() || !url.trim() || !clientId.trim()}
      onConfirm={() => {
        const parsed = URL.parse(url)
        if (parsed?.protocol !== 'https:')
          throw new Error('Enter an HTTPS URL for the Databricks server.')
        onSave({
          name: name.trim(),
          url: parsed.href,
          clientId: clientId.trim(),
          hasSecret: Boolean(secret.trim() || configuration?.hasSecret),
        })
      }}
    >
      <FieldStack>
        <TextField
          placeholder='Name'
          label='Name'
          maxLength={100}
          required
          value={name}
          onChange={setName}
        />
        <TextField
          label='MCP URL'
          maxLength={2048}
          required
          placeholder='https://workspace.cloud.databricks.com/api/2.0/mcp/…'
          value={url}
          onChange={setUrl}
        />
        <TextField
          placeholder='Enter the OAuth client ID'
          label='OAuth Client ID'
          maxLength={512}
          autoComplete='off'
          required
          value={clientId}
          onChange={setClientId}
        />
        <SecretField
          label='OAuth Client Secret'
          optional
          value={secret}
          autoComplete='new-password'
          placeholder={
            configuration?.hasSecret ? 'Leave blank to keep the current secret' : 'Optional'
          }
          onChange={setSecret}
        />
      </FieldStack>
    </Modal>
  )
}

export function GroupProviders({
  data,
  editable,
  onChange,
  databricks,
  onConfigure,
}: GroupProvidersProps) {
  const [search, setSearch] = useQueryState(
    'credential-group-provider',
    parseAsString.withDefault('')
  )
  const params = useSearchParams()
  const scope = useSurfaceScope()
  const [team, setTeam] = useState<string | null>(null)
  const slackTeams = data.slackTeams ?? []
  const selectedTeam = team ?? (slackTeams.length === 1 ? slackTeams[0] : null)
  const [catalog, setCatalog] = useState(false)
  const [choice, setChoice] = useState<string | null>(null)
  const [configuration, setConfiguration] = useState<CredentialProvider>()
  const [removing, setRemoving] = useState<CredentialProvider>()
  const configured = data.catalog.filter((item) => data.configured.includes(item.key))
  const available = data.catalog.filter((item) => !data.configured.includes(item.key))
  const visible = configured.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase())
  )
  function add(key: string) {
    if (!data.configured.includes(key)) onChange([...data.configured, key])
  }
  function choose() {
    const item = available.find((entry) => entry.key === choice)
    if (!item) return
    if (item.provider === 'slack' || item.provider === 'databricks') setConfiguration(item)
    else add(item.key)
  }
  return (
    <SectionStack>
      <SearchField
        label='Search integrations'
        value={search}
        onValueChange={(value) => void setSearch(value)}
      />
      <SettingsSection title='Integrations'>
        {visible.map((item) => (
          <SettingsRow
            key={item.key}
            leading={
              <Icon
                providerId={
                  item.provider === 'github-repositories'
                    ? 'github'
                    : item.provider.replaceAll('-', '_')
                }
              />
            }
            label={item.name}
          >
            {editable && (
              <ActionRow>
                {(item.provider === 'slack' || item.provider === 'databricks') && (
                  <Button size='compact' onClick={() => setConfiguration(item)}>
                    Configure
                  </Button>
                )}
                <ActionMenu
                  icon='I108'
                  label={`${item.name} actions`}
                  actions={[
                    {
                      id: 'remove',
                      label: 'Remove',
                      destructive: true,
                      onSelect: () => setRemoving(item),
                    },
                  ]}
                />
              </ActionRow>
            )}
          </SettingsRow>
        ))}
        {!visible.length && (
          <EmptyState
            title={
              search.trim()
                ? 'No integrations match your search'
                : 'Add an integration to start connecting accounts.'
            }
          />
        )}
        {editable && (
          <SettingsRow label='Available integrations'>
            <Button
              size='compact'
              disabled={!available.length}
              onClick={() => {
                setChoice(null)
                setCatalog(true)
              }}
            >
              Add integration
            </Button>
          </SettingsRow>
        )}
        {editable && configured.some((item) => item.method === 'oauth') && (
          <SettingsRow
            label='App configurations'
            description='Accounts whose app configuration changed will need to reconnect.'
          >
            <Button size='compact' onClick={() => toast.success('Configurations updated')}>
              Update configurations
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
      <Modal
        open={catalog}
        onOpenChange={setCatalog}
        title='Add integration'
        confirmLabel='Add'
        confirmDisabled={!choice}
        onConfirm={choose}
      >
        <SearchableSelect
          label='Available providers'
          searchLabel='Search providers'
          placeholder='Choose an integration'
          options={available.map((item) => ({ value: item.key, label: item.name }))}
          value={choice}
          onValueChange={setChoice}
        />
      </Modal>
      {configuration?.provider === 'slack' && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setConfiguration(undefined)
          }}
          title='Set up Slack app'
          confirmLabel={
            !slackTeams.length || data.configured.includes(configuration.key)
              ? 'Done'
              : 'Verify and add'
          }
          confirmDisabled={slackTeams.length > 1 && !selectedTeam}
          onConfirm={() => {
            if (selectedTeam) add(configuration.key)
          }}
        >
          <FieldStack>
            {slackTeams.length > 1 ? (
              <SearchableSelect
                label='Sim Search app'
                searchLabel='Search Slack workspaces'
                placeholder='Select the Slack workspace'
                options={slackTeams}
                value={selectedTeam}
                onValueChange={setTeam}
              />
            ) : (
              <SettingsRow
                label='Sim Search app'
                description={
                  selectedTeam
                    ? `Installed in ${selectedTeam}`
                    : 'Install Sim Search in your Slack workspace to connect member accounts.'
                }
              />
            )}
            {selectedTeam && (
              <SettingsRow
                label='Member accounts'
                description='Verify member permissions. Members will need to reconnect if their app or permissions change.'
              />
            )}
            <Button
              render={
                <Link href={platformHref(surfaceHref(scope, '/settings/search-slack'), params)} />
              }
            >
              {selectedTeam ? 'Manage Sim Search app' : 'Install Sim Search'}
            </Button>
          </FieldStack>
        </Modal>
      )}
      {configuration?.provider === 'databricks' && (
        <DatabricksForm
          configuration={databricks}
          onClose={() => setConfiguration(undefined)}
          onSave={(value) => {
            onConfigure(value)
            add(configuration.key)
          }}
        />
      )}
      {removing && (
        <Modal
          variant='confirm'
          destructive
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined)
          }}
          title={`Remove ${removing.name}`}
          description='Remove this provider and its connected accounts from the organization?'
          confirmLabel='Remove'
          onConfirm={() => {
            onChange(data.configured.filter((key) => key !== removing.key))
            if (removing.provider === 'databricks') onConfigure(undefined)
          }}
        />
      )}
    </SectionStack>
  )
}
