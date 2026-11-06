'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import {
  Modal,
  MultiSelect,
  SecretField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'

interface ResourceEditorProps {
  kind: IntegrationResource['kind']
  resource?: IntegrationResource
  data: IntegrationCenterData
  onSave: (resource: IntegrationResource) => void
  onClose: () => void
}

const TITLES = { skill: 'skill', mcp: 'MCP', credential: 'credential' } as const

export function ResourceEditor({ kind, resource, data, onSave, onClose }: ResourceEditorProps) {
  const [scope, setScope] = useState(resource?.scope ?? 'personal')
  const [people, setPeople] = useState(
    resource?.people
      .filter((person) => person.id !== resource.owner.id)
      .map((person) => person.id) ?? []
  )
  const [auth, setAuth] = useState(resource?.kind === 'mcp' ? resource.auth : 'none')

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
      onSave({ ...identity, kind, instructions: read('instructions') })
    } else if (kind === 'mcp') {
      const url = new URL(read('url'))
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Enter an HTTP or HTTPS server URL without credentials.')
      onSave({ ...identity, kind, url: url.toString(), auth })
    } else {
      if (!read('key')) throw new Error('Enter a credential key.')
      onSave({
        ...identity,
        kind,
        key: read('key'),
        credentialType: read('credentialType') === 'api-key' ? 'api-key' : 'secret',
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
      <TextField label='Name' name='name' defaultValue={resource?.name} required maxLength={120} />
      <TextAreaField
        label='Description'
        name='description'
        defaultValue={resource?.description}
        maxLength={500}
      />
      {kind === 'skill' && (
        <TextAreaField
          label='Instructions'
          name='instructions'
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
            label='Type'
            name='credentialType'
            defaultValue={resource?.kind === 'credential' ? resource.credentialType : 'secret'}
            options={[
              { value: 'secret', label: 'Secret' },
              { value: 'api-key', label: 'API key' },
            ]}
          />
          <TextField
            label='Key'
            name='key'
            defaultValue={resource?.kind === 'credential' ? resource.key : ''}
            placeholder='API_KEY'
            pattern='[A-Za-z_][A-Za-z0-9_]*'
            hint='Use letters, numbers, and underscores.'
            required
          />
          <SecretField
            label={resource ? 'Replace value' : 'Value'}
            name='value'
            optional={Boolean(resource)}
            required={!resource}
          />
        </>
      )}
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
      {scope === 'shared' && (
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
    </Modal>
  )
}
