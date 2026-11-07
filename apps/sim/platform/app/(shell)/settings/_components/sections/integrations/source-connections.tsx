'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  ResourceList,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type {
  SearchSource,
  SourceConnection,
  SourceSettingsData,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import {
  ActivityRow,
  Button,
  Disclosure,
  EmptyState,
  FileField,
  Icon,
  Modal,
  SearchField,
  SecretField,
  SegmentedControl,
  Select,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

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
  return (
    <SectionStack>
      <DetailHeader title={source.name} backLabel='Sources' backHref={href()} />
      <SearchField
        label='Search connections'
        placeholder={labels.searchPlaceholder}
        onValueChange={setQuery}
      />
      <SettingsSection
        title={
          source.id === 'github'
            ? 'Repositories'
            : source.id === 'gitlab'
              ? 'Projects'
              : 'Connections'
        }
      >
        {connectionList.length ? (
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
        ) : (
          <EmptyState title={query ? 'No matching connections' : labels.empty} />
        )}
        {source.approved && (
          <SettingsRow label={labels.add}>
            <Button size='compact' icon='I074' onClick={() => setAdding(true)}>
              {labels.add}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
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
      confirmLabel='Add'
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
              source.id === 'github' ? 'GitHub App installation' : 'Service account connection'
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
        <SettingsRow key={field.id} field label={field.label} description={field.hint}>
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
        hint={field.hint}
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
  const [fields, setFields] = useState(connection.fields)
  const [removing, setRemoving] = useState(false)
  const changed = Object.entries(fields).some(
    ([key, value]) => value !== (connection.fields[key] ?? '')
  )
  const guard = useSettingsUnsavedGuard({
    isDirty: changed,
    onDiscard: () => setFields(connection.fields),
  })
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
        onBack={() => guard.guardBack(() => router.push(parent))}
        title={connection.name}
        description={connection.paused ? 'Search paused' : source.name}
      />
      <SettingsSection title='Connection settings'>
        <ConfigFields source={source} fields={fields} change={setFields} />
        <ActionRow>
          <Button variant='primary' disabled={!changed} onClick={() => patch({ fields })}>
            Save
          </Button>
          {changed && (
            <Button variant='quiet' onClick={() => setFields(connection.fields)}>
              Discard
            </Button>
          )}
        </ActionRow>
      </SettingsSection>
      <SettingsSection title='Connection'>
        {source.docs && (
          <SettingsRow label='Documentation'>
            <Button
              render={
                <a href={source.docs} target='_blank' rel='noreferrer'>
                  Docs
                </a>
              }
            >
              Docs
            </Button>
          </SettingsRow>
        )}
        <SettingsRow label='Search' description={connection.paused ? 'Paused' : 'Active'}>
          <Button
            size='compact'
            disabled={changed}
            onClick={() => patch({ paused: !connection.paused })}
          >
            {connection.paused ? 'Resume search' : 'Pause search'}
          </Button>
        </SettingsRow>
        <SettingsRow label='Remove connection'>
          <Button
            variant='destructive'
            size='compact'
            disabled={changed}
            onClick={() => setRemoving(true)}
          >
            Remove
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Modal
        open={removing}
        variant='confirm'
        destructive
        title='Remove connection?'
        description={connection.name}
        confirmLabel='Remove'
        onOpenChange={setRemoving}
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
