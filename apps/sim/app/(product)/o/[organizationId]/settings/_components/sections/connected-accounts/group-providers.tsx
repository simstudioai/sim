'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSurface } from '@sim/emcn/settings-section'
import { parseAsString, useQueryState } from 'nuqs'
import {
  ActionRow,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type {
  CredentialGroupActions,
  DatabricksDraft,
} from '@/platform/lib/data/credential-group-actions'
import {
  type CredentialGroupsData,
  type CredentialProvider,
  credentialProviderIconId,
  type DatabricksConfiguration,
} from '@/platform/lib/data/models/connected-accounts'

interface GroupProvidersProps {
  data: CredentialGroupsData
  actions: CredentialGroupActions
  /** The Slack setup dialog for the chosen provider: live member access, or the fixture's example. */
  renderSlackSetup: (provider: CredentialProvider, onClose: () => void) => ReactNode
}

interface DatabricksFormProps {
  configuration?: DatabricksConfiguration
  onSave: (value: DatabricksDraft) => Promise<void>
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
        return onSave({
          name: name.trim(),
          url: parsed.href,
          clientId: clientId.trim(),
          clientSecret: secret,
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
          label='OAuth client ID'
          maxLength={512}
          autoComplete='off'
          required
          value={clientId}
          onChange={setClientId}
        />
        <SecretField
          label='OAuth client secret'
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

export function GroupProviders({ data, actions, renderSlackSetup }: GroupProvidersProps) {
  const [search, setSearch] = useQueryState(
    'credential-group-provider',
    parseAsString.withDefault('')
  )
  const [catalog, setCatalog] = useState(false)
  const [choice, setChoice] = useState<string | null>(null)
  const [configuration, setConfiguration] = useState<CredentialProvider>()
  const [removing, setRemoving] = useState<CredentialProvider>()
  const configured = data.catalog.filter((item) => data.configured.includes(item.key))
  const available = data.catalog.filter((item) => !data.configured.includes(item.key))
  const visible = configured.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase())
  )
  async function add(item: CredentialProvider) {
    if (!data.configured.includes(item.key)) await actions.addProvider(item)
  }
  function choose() {
    const item = available.find((entry) => entry.key === choice)
    if (!item) return
    if (item.provider === 'slack' || item.provider === 'databricks') setConfiguration(item)
    else return add(item)
  }
  const searching = search.trim().length > 0
  const addIntegration = (
    <Button
      size='compact'
      disabled={!available.length}
      disabledReason='Every available integration is already added'
      onClick={() => {
        setChoice(null)
        setCatalog(true)
      }}
    >
      Add integration
    </Button>
  )
  return (
    <SectionStack>
      {configured.length > 0 && (
        <SearchField
          label='Search integrations'
          placeholder='Search integrations…'
          value={search}
          onValueChange={(value) => void setSearch(value)}
        />
      )}
      {visible.length === 0 ? (
        searching && configured.length > 0 ? (
          <EmptyState title='No matching integrations' />
        ) : (
          <EmptyState
            title='No integrations yet'
            description='Choose which integrations people can connect'
            action={addIntegration}
          />
        )
      ) : (
        <SettingsSurface>
          {visible.map((item) => (
            <SettingsRow
              key={item.key}
              leading={<Icon providerId={credentialProviderIconId(item)} />}
              label={item.name}
            >
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
            </SettingsRow>
          ))}
          {configured.some((item) => item.method === 'oauth') && (
            <SettingsRow
              label='App configurations'
              description='Apply this deployment’s current app settings; accounts whose app changed reconnect'
            >
              <Button size='compact' onClick={() => void actions.updateConfigurations()}>
                Update configurations
              </Button>
            </SettingsRow>
          )}
          <SettingsRow
            label='Available integrations'
            description='Choose which integrations people can connect'
          >
            {addIntegration}
          </SettingsRow>
        </SettingsSurface>
      )}
      <Modal
        open={catalog}
        onOpenChange={setCatalog}
        title='Add integration'
        confirmLabel='Add integration'
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
      {configuration?.provider === 'slack' &&
        renderSlackSetup(configuration, () => setConfiguration(undefined))}
      {configuration?.provider === 'databricks' && (
        <DatabricksForm
          configuration={data.databricks}
          onClose={() => setConfiguration(undefined)}
          onSave={actions.saveDatabricks}
        />
      )}
      <ConfirmDialog
        target={removing}
        onClose={() => setRemoving(undefined)}
        title={({ name }) => `Remove ${name}`}
        description='This removes the provider and its connected accounts from the organization.'
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={(provider) => actions.removeProvider(provider)}
      />
    </SectionStack>
  )
}
