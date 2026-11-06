'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { CredentialAccess } from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access'
import styles from '@/platform/app/(shell)/integrations/_components/credential-detail/credential-detail.module.css'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/fixtures/tool-permissions/tool-permissions'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import {
  ActionMenu,
  Button,
  Chip,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import { credentialSharing } from '@/platform/lib/integrations/credential-display'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

interface CredentialDetailProps {
  credential: IntegrationCredential
  integrationName: string
  viewer: IntegrationPerson
  people: readonly IntegrationPerson[]
  onBack: () => void
  onChange: (credential: IntegrationCredential) => void
  onReconnect?: () => void
  onDisconnect: () => void
  onLeave: () => void
}

const METHOD_LABELS = {
  oauth: 'OAuth account',
  service_account: 'Service account',
  personal_token: 'Personal access token',
  mcp: 'MCP connection',
  slack: 'Slack app',
} as const

export function CredentialDetail({
  credential,
  integrationName,
  viewer,
  people,
  onBack,
  onChange,
  onReconnect,
  onDisconnect,
  onLeave,
}: CredentialDetailProps) {
  const [displayName, setDisplayName] = useState(credential.displayName)
  const [description, setDescription] = useState(credential.description)
  const [error, setError] = useState<string>()
  const editable = credential.role === 'admin' && credential.scope.kind !== 'organization-managed'
  const dirty = displayName !== credential.displayName || description !== credential.description
  const access =
    credential.scope.kind === 'workspace'
      ? credential.scope.name
      : credential.scope.kind === 'organization-managed'
        ? `Managed by ${credential.scope.name}`
        : credentialSharing(credential) === 'shared'
          ? 'Shared with selected people'
          : 'Only you'
  return (
    <>
      <ProviderHeading
        name={credential.displayName}
        description={credential.accountLabel ?? integrationName}
        providerId={credential.appId}
      />
      <IntegrationControls
        leading={
          <Chip icon='I093' onClick={onBack}>
            {integrationName}
          </Chip>
        }
      >
        {editable && (
          <ActionMenu
            label='Credential actions'
            icon='I108'
            tooltip={false}
            actions={[
              ...(onReconnect
                ? [{ id: 'reconnect', label: 'Reconnect', onSelect: onReconnect }]
                : []),
              {
                id: 'disconnect',
                label: 'Disconnect',
                separatorBefore: Boolean(onReconnect),
                destructive: true,
                onSelect: onDisconnect,
              },
            ]}
          />
        )}
      </IntegrationControls>
      <form
        className={styles.form}
        aria-label='Credential details'
        onSubmit={(event) => {
          event.preventDefault()
          if (!editable || !displayName.trim()) return
          try {
            const name = displayName.trim()
            const detail = description.trim()
            onChange({ ...credential, displayName: name, description: detail })
            setDisplayName(name)
            setDescription(detail)
            setError(undefined)
          } catch (error) {
            setError(getErrorMessage(error, 'Could not save this credential.'))
          }
        }}
      >
        <TextField
          label='Credential ID'
          placeholder='Credential ID'
          value={credential.id}
          viewOnly
        />
        <TextField
          label='Display name'
          placeholder={`${integrationName} connection`}
          value={displayName}
          onChange={setDisplayName}
          maxLength={255}
          required
          readOnly={!editable}
          error={error}
        />
        <TextAreaField
          label='Description'
          placeholder='What will you use this connection for?'
          value={description}
          onChange={setDescription}
          maxLength={500}
          readOnly={!editable}
          optional
        />
        {credential.instanceUrl && (
          <TextField
            label={
              credential.providerId === 'microsoft-dataverse'
                ? 'Environment URL'
                : 'GitLab instance'
            }
            placeholder='Connection URL'
            value={credential.instanceUrl}
            viewOnly
          />
        )}
        <div className={styles.metadata} data-type='T060'>
          <span>{METHOD_LABELS[credential.type]}</span>
          <span>{access}</span>
        </div>
        {editable && dirty && (
          <div className={styles.actions}>
            <Button
              variant='quiet'
              size='compact'
              onClick={() => {
                setDisplayName(credential.displayName)
                setDescription(credential.description)
                setError(undefined)
              }}
            >
              Cancel
            </Button>
            <Button size='compact' submit disabled={!displayName.trim()}>
              Save changes
            </Button>
          </div>
        )}
      </form>
      {(credential.scope.kind === 'workspace' || credential.scope.kind === 'organization') &&
        credential.type !== 'personal_token' && (
          <CredentialAccess
            credential={credential}
            viewer={viewer}
            people={people}
            onChange={onChange}
            onLeave={onLeave}
          />
        )}
      {credential.permissions && (
        <ToolPermissions
          account={credential}
          permissions={credential.permissions}
          readOnly={!editable}
          onChange={(permissions) => onChange({ ...credential, permissions })}
        />
      )}
    </>
  )
}
