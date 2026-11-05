import { useState } from 'react'
import { ConnectionFields } from '@/platform/app/(shell)/integrations/_components/connection-fields/connection-fields'
import { ActionMenu, Button, FieldFrame, Modal, Select } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  ACCOUNT_METHOD_LABELS,
  type AccountMethod,
  type IntegrationProvider,
  memberSearchMethod,
  type OrganizationIntegration,
} from '@/platform/lib/integrations/model'

interface ConnectionSettingsProps {
  provider: IntegrationProvider
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
  onRemove: () => void
}

type MethodAction =
  | { kind: 'edit' | 'add' | 'remove'; method: AccountMethod }
  | { kind: 'remove-integration' }

export function ConnectionSettings({
  provider,
  integration,
  onChange,
  onRemove,
}: ConnectionSettingsProps) {
  const [action, setAction] = useState<MethodAction | null>(null)
  const [slackSetup, setSlackSetup] = useState(false)
  const remaining = provider.accountMethods.filter(
    (method) => !integration.accountMethods.includes(method)
  )
  const requiredMethod = integration.searchApproved ? memberSearchMethod(provider) : undefined
  function removeMethod(method: AccountMethod) {
    const accountMethods = integration.accountMethods.filter((entry) => entry !== method)
    if (!integration.searchMode && !integration.sources.length && !accountMethods.length)
      return onRemove()
    onChange({
      ...integration,
      accountMethods,
      accounts: integration.accounts.filter((account) => account.method !== method),
      ...(method === 'databricks' && { endpoint: undefined, clientId: undefined }),
    })
  }
  return (
    <SettingsSection title='Integration settings'>
      {integration.accountMethods.map((method) => (
        <SettingsRow
          key={method}
          label={ACCOUNT_METHOD_LABELS[method]}
          description={[
            method === 'databricks'
              ? integration.endpoint
              : method === 'oauth' || method === 'slack'
                ? `${integration.label || provider.name} · ${integration.required ? 'Required' : 'Optional'} for enrollment`
                : 'Managed by the organization',
            requiredMethod === method ? 'Search requires this connection method.' : null,
          ]
            .filter(Boolean)
            .join('. ')}
        >
          <ActionMenu
            label={`Manage ${ACCOUNT_METHOD_LABELS[method]}`}
            icon='I108'
            triggerSize='compact'
            tooltip={false}
            actions={[
              ...(method !== 'mcp'
                ? [
                    {
                      id: 'edit',
                      label: 'Connection settings',
                      onSelect: () => setAction({ kind: 'edit', method }),
                    },
                  ]
                : []),
              {
                id: 'remove',
                label: 'Remove connection method',
                destructive: true,
                disabled: requiredMethod === method,
                separatorBefore: method !== 'mcp',
                onSelect: () => setAction({ kind: 'remove', method }),
              },
            ]}
          />
        </SettingsRow>
      ))}
      {integration.accountMethods.includes('slack') && (
        <SettingsRow
          label='Slack workspace'
          description={
            integration.slackStatus === 'ready'
              ? `${integration.slackTeam ?? 'Workspace'} · Configured`
              : integration.slackStatus === 'needs_update'
                ? 'The Slack app needs updated authorization.'
                : 'Authorize the Slack app before members connect.'
          }
        >
          <Button size='compact' onClick={() => setSlackSetup(true)}>
            Slack setup
          </Button>
        </SettingsRow>
      )}
      {remaining.length > 0 && (
        <SettingsRow
          label='Account connection'
          description={`Let members connect their ${provider.name} accounts.`}
        >
          <Button size='compact' onClick={() => setAction({ kind: 'add', method: remaining[0] })}>
            Add connection
          </Button>
        </SettingsRow>
      )}
      <SettingsRow
        label='Remove integration'
        description={`Remove ${provider.name} from this organization.`}
      >
        <Button size='compact' onClick={() => setAction({ kind: 'remove-integration' })}>
          Remove
        </Button>
      </SettingsRow>
      {(action?.kind === 'edit' || action?.kind === 'add') && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title={action.kind === 'edit' ? 'Connection settings' : 'Add account connection'}
          description={provider.name}
          confirmLabel={action.kind === 'edit' ? 'Save changes' : 'Add connection'}
          onConfirm={(form) => {
            onChange({
              ...integration,
              accountMethods: [...new Set([...integration.accountMethods, action.method])],
              label: String(form.get('label') ?? integration.label).trim(),
              required: form.has('enrollment')
                ? form.get('enrollment') === 'required'
                : integration.required,
              ...(action.method === 'slack' && {
                slackStatus: integration.slackStatus ?? 'not_configured',
              }),
              ...(action.method === 'databricks' && {
                endpoint: String(form.get('endpoint')).trim(),
                clientId: String(form.get('clientId')).trim(),
              }),
            })
          }}
        >
          {action.kind === 'add' && (
            <FieldFrame label='Connection method'>
              <Select
                label='Connection method'
                options={remaining.map((method) => ({
                  value: method,
                  label: ACCOUNT_METHOD_LABELS[method],
                }))}
                value={action.method}
                onValueChange={(value) => {
                  const method = remaining.find((entry) => entry === value)
                  if (method) setAction({ kind: 'add', method })
                }}
              />
            </FieldFrame>
          )}
          <ConnectionFields
            key={action.method}
            method={action.method}
            label={integration.label || provider.name}
            required={integration.required}
            endpoint={integration.endpoint}
            clientId={integration.clientId}
          />
        </Modal>
      )}
      {action?.kind === 'remove' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title='Remove connection method?'
          variant='confirm'
          destructive
          description={`Members will lose access to ${provider.name} through this ${ACCOUNT_METHOD_LABELS[action.method]} connection.`}
          confirmLabel='Remove method'
          onConfirm={() => removeMethod(action.method)}
        />
      )}
      {action?.kind === 'remove-integration' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title={`Remove ${provider.name}?`}
          variant='confirm'
          destructive
          description='Members will lose access to search and account connections configured for this integration.'
          confirmLabel='Remove integration'
          onConfirm={onRemove}
        />
      )}
      {slackSetup && (
        <Modal
          open
          onOpenChange={setSlackSetup}
          title='Slack app setup'
          description={
            integration.slackTeam
              ? `Manage the Slack app for ${integration.slackTeam}.`
              : 'An administrator must authorize the Slack app for the organization’s workspace.'
          }
          confirmLabel='Continue to Slack'
          confirmDisabled
        />
      )}
    </SettingsSection>
  )
}
