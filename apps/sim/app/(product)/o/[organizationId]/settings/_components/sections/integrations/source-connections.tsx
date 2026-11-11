'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { Select } from '@sim/emcn/picker/select'
import { SearchField } from '@sim/emcn/search-field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  DetailHeader,
  FieldStack,
  ResourceList,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { ExternalLink } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/external-link'
import {
  type SearchSource,
  type SourceConnection,
  type SourceSettingsData,
  sourceDescription,
  sourceTypeMeta,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/model'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'

interface SharedProps {
  source: SearchSource
  href: (path?: string) => string
  update: (change: (data: SourceSettingsData) => SourceSettingsData) => void
}

interface ProviderProps extends SharedProps {
  data: SourceSettingsData
}

export function ProviderConnections({ source, data, href, update }: ProviderProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const connectionList = data.connections.filter(
    (item) =>
      item.provider === source.id && item.name.toLowerCase().includes(query.trim().toLowerCase())
  )
  const labels = source.connectionLabels
  const total = data.connections.filter((item) => item.provider === source.id).length
  const addConnection = source.approved ? (
    <Button size='compact' icon='I074' onClick={() => setAdding(true)}>
      {labels.add}
    </Button>
  ) : undefined
  return (
    <SectionStack>
      <DetailHeader
        title={source.name}
        description={sourceDescription(source)}
        backLabel='Sources'
        backHref={href()}
      />
      {total > 0 && (
        <SearchField
          label='Search connections'
          placeholder={labels.searchPlaceholder}
          onValueChange={setQuery}
        />
      )}
      <SettingsList
        title={sourceTypeMeta(source.id).connections}
        empty={
          connectionList.length > 0
            ? undefined
            : query
              ? { title: 'No matching connections' }
              : { title: labels.empty, action: addConnection }
        }
      >
        <ResourceList>
          {connectionList.map((item) => (
            <ActivityRow
              key={item.id}
              title={item.name}
              detail={item.paused ? 'Search paused' : source.name}
              leading={<Icon providerId={source.id} />}
              href={href(`/sources/${item.id}`)}
            />
          ))}
        </ResourceList>
        {addConnection && (
          <SettingsRow label={labels.add} description={labels.title}>
            {addConnection}
          </SettingsRow>
        )}
      </SettingsList>
      {adding && (
        <ConnectionForm
          source={source}
          close={() => setAdding(false)}
          save={(name, fields) => {
            const id = generateId()
            update((current) => ({
              ...current,
              connections: [
                ...current.connections,
                { id, provider: source.id, name, paused: false, fields },
              ],
            }))
            router.push(href(`/sources/${id}`))
          }}
        />
      )}
    </SectionStack>
  )
}

function ConnectionForm({
  source,
  close,
  save,
}: {
  source: SearchSource
  close: () => void
  save: (name: string, fields: Record<string, string>) => void
}) {
  const [fields, setFields] = useState<Record<string, string>>({})
  const [credential, setCredential] = useState('')
  const required = source.fields.filter((field) => field.required && field.mode !== 'basic')
  const valid = credential.trim() && required.every((field) => fields[field.id]?.trim())
  const title = source.connectionLabels.title
  return (
    <Modal
      title={title}
      open
      onOpenChange={(open) => !open && close()}
      confirmLabel='Add connection'
      confirmDisabled={!valid}
      onConfirm={() =>
        save(
          fields.repository ||
            fields.project ||
            fields.domain ||
            fields.adminEmail ||
            fields.docIds ||
            source.name,
          fields
        )
      }
    >
      <FieldStack>
        {source.id === 'gitlab' || source.id === 'coda' ? (
          <SecretField
            placeholder='Enter an API token'
            label='API token'
            value={credential}
            onChange={setCredential}
          />
        ) : (
          <TextField
            placeholder='Connection ID'
            label={
              sourceTypeMeta(source.id).appInstallation
                ? 'GitHub App installation'
                : 'Service account connection'
            }
            value={credential}
            onChange={setCredential}
          />
        )}
        <ConfigFields source={source} fields={fields} change={setFields} />
      </FieldStack>
    </Modal>
  )
}

function ConfigFields({
  source,
  fields,
  change,
}: {
  source: SearchSource
  fields: Record<string, string>
  change: (fields: Record<string, string>) => void
}) {
  const [entryMode, setMode] = useState<'basic' | 'advanced'>('basic')
  const paired = source.fields.some((field) => field.mode === 'basic')
  const visible = source.fields.filter(
    (field) => !field.mode || !paired || field.mode === entryMode
  )
  function renderField(field: SearchSource['fields'][number]) {
    const setValue = (value: string) => change({ ...fields, [field.id]: value })
    const value = fields[field.id] ?? ''
    if (field.options?.length)
      return (
        <SettingsRow key={field.id} field label={field.label}>
          <Select
            label={field.label}
            value={value}
            onValueChange={setValue}
            options={[{ value: '', label: 'Default' }, ...field.options]}
          />
        </SettingsRow>
      )
    return (
      <TextField
        key={field.id}
        label={field.label}
        value={value}
        onChange={setValue}
        placeholder={field.placeholder ?? field.label}
        required={field.required}
      />
    )
  }
  return (
    <FieldStack>
      {paired && (
        <SegmentedControl
          label='Resource selection'
          options={[
            { value: 'basic', label: 'Select' },
            { value: 'advanced', label: 'Enter IDs' },
          ]}
          value={entryMode}
          onSelect={setMode}
        />
      )}
      {visible.filter((field) => !field.optional).map(renderField)}
      {visible.some((field) => field.optional) && (
        <Disclosure label='More options'>
          <FieldStack>{visible.filter((field) => field.optional).map(renderField)}</FieldStack>
        </Disclosure>
      )}
      {source.id === 'gitlab' && <GitLabPermissions fields={fields} change={change} />}
    </FieldStack>
  )
}

function GitLabPermissions({
  fields,
  change,
}: {
  fields: Record<string, string>
  change: (fields: Record<string, string>) => void
}) {
  const csv = fields.permissionMode === 'csv'
  return (
    <FieldStack>
      <SegmentedControl
        label='Permissions'
        value={csv ? 'csv' : 'admin'}
        options={[
          { value: 'admin', label: 'Administrator token' },
          { value: 'csv', label: 'Non-admin token' },
        ]}
        onSelect={(value) => change({ ...fields, permissionMode: value })}
      />
      {csv &&
        ['User mapping', 'Project permissions'].map((label) => (
          <FileField
            key={label}
            label={label}
            accept='.csv'
            selection={fields[label] ? { name: fields[label] } : undefined}
            onFileChange={(file) => change({ ...fields, [label]: file.name })}
            onClear={() => change({ ...fields, [label]: '' })}
          />
        ))}
    </FieldStack>
  )
}

interface DetailsProps extends SharedProps {
  connection: SourceConnection
}

export function ConnectionDetails({ source, connection, href, update }: DetailsProps) {
  const router = useRouter()
  const parent = href(`/providers/${source.id}`)
  const [edited, setEdited] = useState<Record<string, string> | null>(null)
  const fields = edited ?? connection.fields
  const [removing, setRemoving] = useState(false)
  const changed = Object.entries(fields).some(
    ([key, value]) => value !== (connection.fields[key] ?? '')
  )
  const patch = (change: Partial<SourceConnection>) =>
    update((current) => ({
      ...current,
      connections: current.connections.map((entry) =>
        entry.id === connection.id ? { ...entry, ...change } : entry
      ),
    }))
  return (
    <SectionStack>
      <DetailHeader
        backLabel={source.name}
        onBack={() => requestSettingsLeave(() => router.push(parent))}
        title={connection.name}
        description={connection.paused ? 'Search paused' : source.name}
      >
        {source.docs && <ExternalLink href={source.docs} label='Docs' />}
      </DetailHeader>
      <SettingsSection title='Connection settings'>
        <ConfigFields source={source} fields={fields} change={setEdited} />
      </SettingsSection>
      <SettingsSaveBar
        dirty={changed}
        saving={false}
        onSave={() => {
          patch({ fields })
          setEdited(null)
        }}
        onDiscard={() => setEdited(null)}
      />
      <SettingsSection title='Connection'>
        <SettingsRow label='Search' description={connection.paused ? 'Paused' : 'Active'}>
          <Button
            size='compact'
            disabled={changed}
            onClick={() => patch({ paused: !connection.paused })}
          >
            {connection.paused ? 'Resume search' : 'Pause search'}
          </Button>
        </SettingsRow>
        <SettingsRow label='Remove connection' description='Disconnect this source from Sim Search'>
          <Button
            variant='quiet'
            destructive
            size='compact'
            disabled={changed}
            onClick={() => setRemoving(true)}
          >
            Remove
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        target={removing}
        onClose={() => setRemoving(false)}
        title={`Remove ${connection.name}`}
        description='Sim Search stops reading this connection'
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={() => {
          update((current) => ({
            ...current,
            connections: current.connections.filter((item) => item.id !== connection.id),
            sources: current.sources.map((item) =>
              item.connectionId === connection.id ? { ...item, connectionId: undefined } : item
            ),
          }))
          router.replace(parent)
        }}
      />
    </SectionStack>
  )
}
