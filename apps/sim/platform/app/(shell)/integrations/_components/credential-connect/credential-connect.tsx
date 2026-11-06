'use client'

import { useState } from 'react'
import { toRecord } from '@sim/utils/object'
import Link from 'next/link'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import type { CredentialDraft } from '@/platform/app/(shell)/integrations/_components/credential-connect/types'
import { SlackBotConnection } from '@/platform/app/(shell)/integrations/_components/slack-bot-connection/slack-bot-connection'
import {
  Button,
  CopyField,
  FileField,
  Modal,
  SecretField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import type {
  CredentialConnection,
  CredentialField,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'

interface CredentialConnectProps {
  integrationName: string
  connection: CredentialConnection
  workspaces: readonly { id: string; name: string }[]
  initial?: IntegrationCredential
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
        hint={field.hint}
        optional={field.optional}
      />
    )
  if (field.multiline)
    return (
      <TextAreaField
        label={field.label}
        value={value}
        onChange={onChange}
        placeholder={field.placeholder}
        hint={field.hint}
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
        placeholder={field.placeholder}
        hint={field.hint}
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
      placeholder={field.placeholder}
      hint={field.hint}
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
        workspaces={props.workspaces}
        initial={props.initial}
        onClose={props.onClose}
        onSubmit={props.onSubmit}
      />
    )
  return (
    <CredentialConnectForm
      integrationName={props.integrationName}
      connection={props.connection}
      workspaces={props.workspaces}
      initial={props.initial}
      onClose={props.onClose}
      onSubmit={props.onSubmit}
    />
  )
}

function CredentialConnectForm({
  integrationName,
  connection,
  workspaces,
  initial,
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
  const [workspaceId, setWorkspaceId] = useState(
    initial?.scope.kind === 'workspace' ? initial.scope.id : (workspaces[0]?.id ?? '')
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
    fields.some((field) => !field.optional && !values[field.id]?.trim()) ||
    (!connection.personalOnly && !workspaceId) ||
    (connection.setup === 'oauth' && !displayName.trim())
  function change(id: string, value: string) {
    setValues((current) => ({ ...current, [id]: value }))
  }
  return (
    <Modal
      open
      title={initial ? `Reconnect ${initial.displayName}` : `Connect ${integrationName}`}
      confirmLabel={initial ? 'Reconnect' : 'Connect'}
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
        if (connection.personalOnly && !instanceUrl) {
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
          workspaceId: connection.personalOnly ? undefined : workspaceId,
          instanceUrl:
            connection.personalOnly || connection.providerId === 'microsoft-dataverse'
              ? instanceUrl
              : undefined,
        }
        setValues({})
        onSubmit(draft)
      }}
    >
      {!connection.personalOnly && !initial && (
        <SelectField
          label='Workspace'
          value={workspaceId}
          onValueChange={setWorkspaceId}
          options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
        />
      )}
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
      {connection.kind !== 'personal_token' && (
        <>
          <TextField
            label='Display name'
            value={displayName}
            onChange={setDisplayName}
            maxLength={255}
            required={connection.setup === 'oauth'}
            optional={connection.setup !== 'oauth'}
          />
          <TextAreaField
            label='Description'
            value={description}
            onChange={setDescription}
            maxLength={500}
            optional
          />
        </>
      )}
      {connection.requiredScopes && connection.requiredScopes.length > 0 && (
        <ConnectionAccess
          integration={{
            searchReads: [],
            searchResource: null,
            requestedScopes: connection.requiredScopes,
            accessDescription: '',
            availability: 'catalog',
          }}
        />
      )}
      {connection.docsUrl && (
        <Button
          variant='quiet'
          icon='I082'
          render={<Link href={connection.docsUrl} target='_blank' rel='noopener noreferrer' />}
        >
          Docs
        </Button>
      )}
    </Modal>
  )
}
