'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { CredentialAccess } from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access'
import styles from '@/platform/app/(shell)/integrations/_components/credential-detail/credential-detail.module.css'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/fixtures/tool-permissions/tool-permissions'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import {
  ActionMenu,
  Button,
  Chip,
  ContentTabs,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import { credentialDetailParams } from '@/platform/lib/integrations/credential-navigation'

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
  const [view, setView] = useQueryStates(credentialDetailParams)
  const [displayName, setDisplayName] = useState(credential.displayName)
  const [description, setDescription] = useState(credential.description)
  const [error, setError] = useState<string>()
  const editable = credential.role === 'admin' && credential.scope.kind !== 'organization-managed'
  const dirty = displayName !== credential.displayName || description !== credential.description
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
      <ContentTabs
        label='Credential details'
        current={
          view.credentialTab === 'permissions' && !credential.permissions
            ? 'details'
            : view.credentialTab
        }
        onSelect={(credentialTab) => {
          if (
            credentialTab === 'details' ||
            credentialTab === 'access' ||
            credentialTab === 'permissions'
          )
            void setView({ credentialTab })
        }}
        items={[
          {
            id: 'details',
            label: 'Details',
            content: (
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
                {credential.scope.kind === 'organization-managed' && (
                  <p className={styles.managed} data-type='T060'>
                    Managed by {credential.scope.name}
                  </p>
                )}
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
            ),
          },
          {
            id: 'access',
            label: 'Access',
            content: (
              <CredentialAccess
                credential={credential}
                viewer={viewer}
                people={people}
                onChange={onChange}
                onLeave={onLeave}
              />
            ),
          },
          ...(credential.permissions
            ? [
                {
                  id: 'permissions',
                  label: 'Permissions',
                  content: (
                    <ToolPermissions
                      account={credential}
                      permissions={credential.permissions}
                      readOnly={!editable}
                      onChange={(permissions) => onChange({ ...credential, permissions })}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  )
}
