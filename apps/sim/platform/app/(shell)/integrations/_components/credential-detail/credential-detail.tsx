'use client'

import { useState } from 'react'
import { CredentialAccess } from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/fixtures/tool-permissions/tool-permissions'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import {
  ActionMenu,
  Button,
  Chip,
  CopyField,
  Modal,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
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
  const [editing, setEditing] = useState(false)
  const editable = credential.role === 'admin' && credential.scope.kind !== 'organization-managed'
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
      <SettingsSection title='Details'>
        <SettingsRow label='Connection method' description={METHOD_LABELS[credential.type]} />
        <SettingsRow label='Display name' description={credential.displayName}>
          {editable && (
            <Button variant='quiet' size='compact' onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </SettingsRow>
        <SettingsRow
          label='Description'
          description={credential.description || 'Add a description'}
        >
          {editable && (
            <Button variant='quiet' size='compact' onClick={() => setEditing(true)}>
              Edit description
            </Button>
          )}
        </SettingsRow>
        <SettingsRow
          label='Access'
          description={
            credential.scope.kind === 'workspace'
              ? credential.scope.name
              : credential.scope.kind === 'organization-managed'
                ? `Managed by ${credential.scope.name}`
                : 'Only you'
          }
        />
      </SettingsSection>
      <CopyField label='Credential ID' value={credential.id} />
      {credential.instanceUrl && (
        <CopyField
          label={
            credential.providerId === 'microsoft-dataverse' ? 'Environment URL' : 'GitLab instance'
          }
          value={credential.instanceUrl}
        />
      )}
      {credential.scope.kind === 'workspace' && credential.type !== 'personal_token' && (
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
      {editing && (
        <Modal
          open
          title='Edit credential'
          confirmLabel='Save'
          onOpenChange={setEditing}
          onConfirm={(values) => {
            const displayName = String(values.get('displayName') ?? '').trim()
            if (!displayName) return false
            onChange({
              ...credential,
              displayName,
              description: String(values.get('description') ?? '').trim(),
            })
          }}
        >
          <TextField
            label='Display name'
            name='displayName'
            defaultValue={credential.displayName}
            maxLength={255}
            required
          />
          <TextAreaField
            label='Description'
            name='description'
            defaultValue={credential.description}
            maxLength={500}
            optional
          />
        </Modal>
      )}
    </>
  )
}
