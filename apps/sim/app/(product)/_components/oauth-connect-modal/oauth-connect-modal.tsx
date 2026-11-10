'use client'

import { useRef } from 'react'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { ListField } from '@sim/emcn/field/list-field'
import { CopyField, SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { type OAuthConnectOptions, useOAuthConnect } from '@/platform/lib/data/credentials'

interface OAuthConnectModalProps extends OAuthConnectOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs when the viewer closes the dialog without starting the provider's sign-in. */
  onDismiss?: () => void
  /** The provider's setup guide, offered at the footer's start. */
  docsUrl?: string
}

/**
 * Connects a new OAuth account, or reauthorizes an existing one with the scopes it now needs, and
 * hands the browser to the provider. Shared by a workflow block's credential picker, a knowledge
 * base's connectors and an organization's Search source setup; `scope` names the workspace or
 * organization that owns the credential, and `returnTo` the page the provider sends the viewer back
 * to, whose OAuth return handling selects or restores the account.
 */
export function OAuthConnectModal({
  open,
  onOpenChange,
  onDismiss,
  docsUrl,
  ...options
}: OAuthConnectModalProps) {
  const connect = useOAuthConnect({ open, ...options })
  const startedRef = useRef(false)
  const newScopes = connect.scopeRows.filter((row) => row.isNew)
  const otherScopes = connect.scopeRows.filter((row) => !row.isNew)

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !startedRef.current) onDismiss?.()
        if (next) startedRef.current = false
        onOpenChange(next)
      }}
      title={connect.title}
      description={connect.explanation}
      confirmLabel={connect.isPending ? 'Connecting…' : connect.actionLabel}
      confirmDisabled={connect.confirmDisabled}
      pending={connect.isPending}
      footerStartAction={
        docsUrl
          ? {
              label: 'Setup guide',
              variant: 'quiet',
              onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
            }
          : undefined
      }
      onConfirm={async () => {
        const result = await connect.connect()
        if (result !== false) startedRef.current = true
        return result
      }}
    >
      {connect.authServer && (
        <SelectField
          label='Environment'
          value={connect.authServer.value}
          onValueChange={connect.authServer.onChange}
          options={connect.authServer.options}
          hint={connect.authServer.hint}
        />
      )}
      {connect.isConnect && (
        <TextField
          label='Display name'
          value={connect.displayName}
          onChange={connect.setDisplayName}
          placeholder='Integration name'
          autoComplete='off'
          required
          error={connect.displayNameError}
        />
      )}
      {connect.environment &&
        (connect.environment.locked ? (
          <CopyField
            label='Environment URL'
            value={connect.environment.value}
            hint='This connection is locked to the environment selected by the workflow or credential.'
          />
        ) : (
          <TextField
            label='Environment URL'
            type='url'
            value={connect.environment.value}
            onChange={connect.environment.onChange}
            placeholder='https://myorg.crm.dynamics.com'
            autoComplete='off'
            required
            error={connect.environment.error}
            hint='This credential is restricted to one public-cloud Dataverse environment.'
          />
        ))}
      {connect.redirectUri && <CopyField label='Redirect URI' value={connect.redirectUri} />}
      {connect.clientFields.map((field) =>
        field.options ? (
          <SelectField
            key={field.id}
            label={field.label}
            value={connect.clientFieldValues[field.id] ?? ''}
            onValueChange={(value) => connect.setClientField(field.id, value)}
            options={field.options}
          />
        ) : field.secret ? (
          <SecretField
            key={field.id}
            label={field.label}
            value={connect.clientFieldValues[field.id] ?? ''}
            onChange={(value) => connect.setClientField(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='new-password'
            required
          />
        ) : (
          <TextField
            key={field.id}
            label={field.label}
            value={connect.clientFieldValues[field.id] ?? ''}
            onChange={(value) => connect.setClientField(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='off'
            required
          />
        )
      )}
      {connect.isConnect && (
        <TextAreaField
          label='Description'
          value={connect.description}
          onChange={connect.setDescription}
          placeholder='Optional description'
          maxLength={500}
          optional
        />
      )}
      <ListField
        label='Permissions requested'
        groups={[
          {
            id: 'new',
            label: newScopes.length > 0 ? 'New' : undefined,
            items: newScopes.map((row) => ({ id: row.scope, label: row.description })),
          },
          {
            id: 'requested',
            items: otherScopes.map((row) => ({ id: row.scope, label: row.description })),
          },
        ]}
      />
    </Modal>
  )
}
