'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import { ManualSecretFields } from '@/platform/app/(shell)/integrations/_components/manual-secret-fields/manual-secret-fields'
import {
  Button,
  Modal,
  MultiSelect,
  SecretField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import type {
  AppSummary,
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'
import {
  MANUAL_SECRET_TYPES,
  type ManualSecretType,
  validateManualSecret,
} from '@/platform/lib/integrations/manual-secret'

interface ResourceEditorProps {
  kind: IntegrationResource['kind']
  resource?: Exclude<IntegrationResource, { kind: 'credential' }>
  data: IntegrationCenterData
  onSave: (resource: IntegrationResource) => void
  onClose: () => void
  onDelete?: () => void
  apps?: readonly Pick<AppSummary, 'id' | 'name'>[]
  appId?: string
}

const TITLES = { skill: 'skill', mcp: 'MCP', credential: 'credential' } as const

export function ResourceEditor({
  kind,
  resource,
  data,
  onSave,
  onClose,
  onDelete,
  apps = [],
  appId,
}: ResourceEditorProps) {
  const [scope, setScope] = useState(resource?.scope ?? 'personal')
  const [people, setPeople] = useState(
    resource?.people
      .filter((person) => person.id !== resource.owner.id)
      .map((person) => person.id) ?? []
  )
  const [auth, setAuth] = useState(resource?.kind === 'mcp' ? resource.auth : 'none')
  const [secretType, setSecretType] = useState<ManualSecretType>('secret')
  const [provider, setProvider] = useState(appId ?? '')

  function save(values: FormData) {
    if (resource?.canEdit === false) return
    const read = (name: string) => String(values.get(name) ?? '').trim()
    const name = read('name')
    if (!name) throw new Error('Enter a name.')
    const identity = {
      id: resource?.id ?? generateId(),
      name,
      description: read('description'),
      scope,
      owner: resource?.owner ?? data.viewer,
      people:
        scope === 'shared'
          ? data.people.filter(
              (person) =>
                people.includes(person.id) || person.id === (resource?.owner.id ?? data.viewer.id)
            )
          : [resource?.owner ?? data.viewer],
      canEdit: true,
    }
    if (scope === 'shared' && !people.length)
      throw new Error('Choose at least one person to share with.')
    if (kind === 'skill') {
      if (!read('instructions')) throw new Error('Add instructions for this skill.')
      onSave({
        ...identity,
        kind,
        instructions: read('instructions'),
        source: resource?.kind === 'skill' ? resource.source : undefined,
      })
    } else if (kind === 'mcp') {
      const url = new URL(read('url'))
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Enter an HTTP or HTTPS server URL without credentials.')
      onSave({ ...identity, kind, url: url.toString(), auth })
    } else {
      if (!read('key')) throw new Error('Enter a credential key.')
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(read('key')))
        throw new Error('Use letters, numbers, and underscores for the key.')
      validateManualSecret(secretType, values)
      onSave({
        ...identity,
        kind,
        key: read('key'),
        credentialType: secretType,
        appId: provider || undefined,
        scope: 'personal',
        people: [data.viewer],
        owner: data.viewer,
        members: [
          {
            ...data.viewer,
            userId: data.viewer.id,
            role: 'admin',
            roleSource: 'explicit',
            explicitAdmin: true,
            status: 'active',
          },
        ],
      })
    }
    onClose()
  }

  return (
    <Modal
      open
      title={`${resource ? 'Edit' : 'Create'} ${TITLES[kind]}`}
      confirmLabel={resource ? 'Save changes' : kind === 'mcp' ? 'Connect' : 'Create'}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onConfirm={save}
    >
      <TextField
        label='Name'
        placeholder={`${TITLES[kind]} name`}
        name='name'
        defaultValue={resource?.name}
        required
        maxLength={120}
      />
      <TextAreaField
        label='Description'
        placeholder='Describe what this is for'
        name='description'
        defaultValue={resource?.description}
        maxLength={500}
      />
      {kind === 'skill' && (
        <TextAreaField
          label='Instructions'
          placeholder='Describe what this skill should do'
          name='instructions'
          defaultSize='large'
          defaultValue={resource?.kind === 'skill' ? resource.instructions : ''}
          required
        />
      )}
      {kind === 'mcp' && (
        <>
          <TextField
            label='Server URL'
            name='url'
            type='url'
            defaultValue={resource?.kind === 'mcp' ? resource.url : ''}
            placeholder='https://mcp.example.com'
            required
          />
          <SelectField
            label='Authentication'
            name='auth'
            value={auth}
            onValueChange={(value) => {
              if (value === 'none' || value === 'bearer' || value === 'oauth') setAuth(value)
            }}
            options={[
              { value: 'none', label: 'None' },
              { value: 'bearer', label: 'Bearer token' },
              { value: 'oauth', label: 'OAuth' },
            ]}
          />
          {auth === 'bearer' && (
            <SecretField
              label='Token'
              placeholder='Paste a bearer token'
              name='token'
              optional={Boolean(resource)}
              required={!resource}
            />
          )}
        </>
      )}
      {kind === 'credential' && (
        <>
          <SelectField
            label='App'
            value={provider}
            onValueChange={setProvider}
            disabled={Boolean(appId)}
            options={[
              { value: '', label: 'No app' },
              ...apps.map((app) => ({ value: app.id, label: app.name })),
            ]}
          />
          <SelectField
            label='Type'
            value={secretType}
            onValueChange={(value) => {
              const option = MANUAL_SECRET_TYPES.find((option) => option.value === value)
              if (option) setSecretType(option.value)
            }}
            options={MANUAL_SECRET_TYPES}
          />
          <TextField
            label='Key'
            name='key'
            placeholder='API_KEY'
            pattern='[A-Za-z_][A-Za-z0-9_]*'
            hint='Use letters, numbers, and underscores.'
            required
          />
          <ManualSecretFields key={secretType} type={secretType} />
        </>
      )}
      {kind !== 'credential' && (
        <SelectField
          label='Access'
          value={scope}
          disabled={Boolean(resource && resource.owner.id !== data.viewer.id)}
          onValueChange={(value) => {
            if (value === 'shared' || value === 'personal') setScope(value)
          }}
          options={[
            { value: 'personal', label: 'Personal' },
            { value: 'shared', label: 'Shared' },
          ]}
        />
      )}
      {kind !== 'credential' && scope === 'shared' && (
        <MultiSelect
          label='People with access'
          searchLabel='Find people'
          placeholder='Choose people'
          options={data.people
            .filter((person) => person.id !== (resource?.owner.id ?? data.viewer.id))
            .map((person) => ({ value: person.id, label: person.name }))}
          value={people}
          onValueChange={setPeople}
        />
      )}
      {onDelete && (
        <div>
          <Button variant='quiet' onClick={onDelete}>{`Delete ${TITLES[kind]}`}</Button>
        </div>
      )}
    </Modal>
  )
}
