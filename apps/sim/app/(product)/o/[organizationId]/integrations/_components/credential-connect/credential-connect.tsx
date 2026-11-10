'use client'

import { useState } from 'react'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { CopyField, SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { toRecord } from '@sim/utils/object'
import { ConnectionAccess } from '@/app/(product)/o/[organizationId]/integrations/_components/connection-access/connection-access'
import type { CredentialDraft } from '@/app/(product)/o/[organizationId]/integrations/_components/credential-connect/types'
import { SlackBotConnection } from '@/app/(product)/o/[organizationId]/integrations/_components/slack-bot-connection/slack-bot-connection'
import type {
  CredentialConnection,
  CredentialField,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'

interface CredentialConnectProps {
  integrationName: string
  connection: CredentialConnection
  initial?: IntegrationCredential
  access?: readonly { id: string; label: string }[]
  onClose: () => void
  onSubmit: (draft: CredentialDraft) => void
}

interface ConnectionFieldProps {
  field: CredentialField
  value: string
  onChange: (value: string) => void
}

function ConnectionField({ field, value, onChange }: ConnectionFieldProps) {
  if (field.options)
    return (
      <SelectField
        label={field.label}
        value={value}
        onValueChange={onChange}
        options={field.options}
        optional={field.optional}
      />
    )
  if (field.multiline)
    return (
      <TextAreaField
        label={field.label}
        value={value}
        onChange={onChange}
        placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
        optional={field.optional}
        required={!field.optional}
      />
    )
  if (field.secret)
    return (
      <SecretField
        label={field.label}
        value={value}
        onChange={onChange}
        placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
        optional={field.optional}
        required={!field.optional}
        autoComplete='new-password'
      />
    )
  return (
    <TextField
      label={field.label}
      value={value}
      onChange={onChange}
      placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
      optional={field.optional}
      required={!field.optional}
      autoComplete='off'
    />
  )
}

export function CredentialConnect(props: CredentialConnectProps) {
  if (props.connection.setup === 'slack-bot')
    return (
      <SlackBotConnection
        initial={props.initial}
        onClose={props.onClose}
        onSubmit={props.onSubmit}
      />
    )
  return (
    <CredentialConnectForm
      integrationName={props.integrationName}
      connection={props.connection}
      initial={props.initial}
      access={props.access}
      onClose={props.onClose}
      onSubmit={props.onSubmit}
    />
  )
}

function CredentialConnectForm({
  integrationName,
  connection,
  initial,
  access,
  onClose,
  onSubmit,
}: CredentialConnectProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      connection.fields.map((field) => [
        field.id,
        (field.id === 'domain' || field.id === 'dataverseEnvironmentUrl') && initial?.instanceUrl
          ? initial.instanceUrl
          : (field.defaultValue ?? ''),
      ])
    )
  )
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [file, setFile] = useState<{ name: string } | undefined>()
  const [fileError, setFileError] = useState<string>()
  const fields = connection.fields.filter((field) => {
    if (
      field.visibleWhen &&
      !field.visibleWhen.values.includes(values[field.visibleWhen.field] ?? '')
    )
      return false
    if (
      connection.setup === 'oracle-database' &&
      field.id === 'walletPassword' &&
      !values.walletContent
    )
      return false
    return true
  })
  const disabled =
    fields.some((field) => !field.optional && !values[field.id]?.trim()) || !displayName.trim()
  function change(id: string, value: string) {
    setValues((current) => ({ ...current, [id]: value }))
  }
  return (
    <Modal
      open
      title={initial ? `Reconnect ${initial.displayName}` : `Connect ${integrationName}`}
      confirmLabel={
        initial
          ? 'Reconnect'
          : connection.setup === 'oauth' || connection.setup === 'mcp-oauth'
            ? 'Continue'
            : 'Connect'
      }
      confirmDisabled={disabled}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onConfirm={() => {
        let name = displayName.trim()
        let accountLabel = initial?.accountLabel
        if (connection.setup === 'google-json') {
          let key: Record<string, unknown>
          try {
            key = toRecord(JSON.parse(values.serviceAccountJson ?? ''))
          } catch {
            throw new Error('Enter a valid service account JSON key.')
          }
          if (
            key.type !== 'service_account' ||
            !['client_email', 'private_key', 'project_id'].every(
              (field) => typeof key[field] === 'string' && key[field]
            )
          )
            throw new Error(
              'The JSON key needs a service account email, private key, and project ID.'
            )
          if (typeof key.client_email === 'string') {
            accountLabel = key.client_email
            if (!name) name = accountLabel
          }
        }
        const host = values.domain?.trim()
        let instanceUrl = initial?.instanceUrl
        if (connection.kind === 'personal_token' && !instanceUrl) {
          let instance: URL
          try {
            instance = new URL(host?.includes('://') ? host : `https://${host}`)
          } catch {
            throw new Error('Enter a valid GitLab host.')
          }
          if (
            instance.protocol !== 'https:' ||
            instance.username ||
            instance.password ||
            instance.search ||
            instance.hash ||
            (instance.pathname !== '/' && instance.pathname !== '')
          )
            throw new Error('Enter a GitLab HTTPS host without a path, query, or credentials.')
          instanceUrl = instance.origin
        }
        if (connection.providerId === 'microsoft-dataverse' && !instanceUrl) {
          let environment: URL
          try {
            environment = new URL(values.dataverseEnvironmentUrl)
          } catch {
            throw new Error('Enter a valid environment URL.')
          }
          if (
            environment.protocol !== 'https:' ||
            environment.username ||
            environment.password ||
            environment.search ||
            environment.hash ||
            (environment.pathname !== '/' && environment.pathname !== '')
          )
            throw new Error('Enter an HTTPS environment URL without a path, query, or credentials.')
          instanceUrl = environment.origin
        }
        const draft: CredentialDraft = {
          displayName: name || integrationName,
          description: description.trim(),
          accountLabel,
          instanceUrl:
            connection.kind === 'personal_token' || connection.providerId === 'microsoft-dataverse'
              ? instanceUrl
              : undefined,
        }
        onSubmit(draft)
        setValues({})
      }}
    >
      <TextField
        label='Display name'
        placeholder={`${integrationName} connection`}
        value={displayName}
        onChange={setDisplayName}
        maxLength={255}
        required
      />
      <TextAreaField
        label='Description'
        placeholder='What will you use this connection for?'
        value={description}
        onChange={setDescription}
        maxLength={500}
        optional
      />
      {fields.map((field) =>
        initial?.instanceUrl &&
        ((initial.type === 'personal_token' && field.id === 'domain') ||
          (initial.providerId === 'microsoft-dataverse' &&
            field.id === 'dataverseEnvironmentUrl')) ? (
          <CopyField
            key={field.id}
            label={field.label}
            value={initial.instanceUrl ?? values[field.id] ?? ''}
          />
        ) : (
          <ConnectionField
            key={field.id}
            field={field}
            value={values[field.id] ?? ''}
            onChange={(value) => change(field.id, value)}
          />
        )
      )}
      {connection.setup === 'google-json' && (
        <FileField
          label='Or upload a JSON key'
          accept='.json,application/json'
          selection={file}
          error={fileError}
          onClear={() => {
            setFile(undefined)
            change('serviceAccountJson', '')
          }}
          onFileChange={async (file) => {
            if (file.size > 2 * 1024 * 1024) {
              setFileError('Choose a JSON key smaller than 2 MB.')
              return
            }
            try {
              change('serviceAccountJson', await file.text())
              setFile({ name: file.name })
              setFileError(undefined)
            } catch {
              setFileError('Could not read this file.')
            }
          }}
        />
      )}
      <ConnectionAccess
        permissions={connection.requiredScopes?.length ? connection.requiredScopes : (access ?? [])}
        title={connection.requiredScopes?.length ? 'Requested permissions' : 'Connection access'}
      />
    </Modal>
  )
}
