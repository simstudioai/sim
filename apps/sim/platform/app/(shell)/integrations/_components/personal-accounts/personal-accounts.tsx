import { useState } from 'react'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/personal-accounts/tool-permissions'
import { ActionMenu, Button, FieldFrame, Modal, Select } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  ACCOUNT_METHOD_LABELS,
  type AccountMethod,
  type IntegrationAccount,
  type IntegrationProvider,
  type OrganizationIntegration,
} from '@/platform/lib/integrations/model'

const AUTHORIZATION: Record<AccountMethod, string> = {
  oauth: 'Sign in with your provider account to give Sim access.',
  slack: 'Authorize your member account with the Slack app configured for this organization.',
  mcp: 'Sign in to the managed MCP server with your own provider account.',
  databricks: 'Sign in to the Databricks MCP endpoint configured by your organization.',
}

interface PersonalAccountsProps {
  provider: IntegrationProvider
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
}

type AccountAction =
  | { kind: 'permissions' | 'disconnect' | 'reconnect'; account: IntegrationAccount }
  | { kind: 'connect' }

interface AuthorizationDialogProps {
  provider: IntegrationProvider
  methods: readonly AccountMethod[]
  account?: IntegrationAccount
  slackStatus?: OrganizationIntegration['slackStatus']
  onClose: () => void
}

function AuthorizationDialog({
  provider,
  methods,
  account,
  slackStatus,
  onClose,
}: AuthorizationDialogProps) {
  const [method, setMethod] = useState(account?.method ?? methods[0])
  if (!method) return null
  const guidance =
    method === 'slack' && slackStatus !== 'ready'
      ? 'An administrator needs to authorize the organization’s Slack app before members can connect.'
      : AUTHORIZATION[method]
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={account ? 'Reconnect account' : `Connect to ${provider.name}`}
      description={account?.label ?? guidance}
      confirmLabel={`Continue to ${provider.name}`}
      confirmDisabled
    >
      {!account && methods.length > 1 && (
        <FieldFrame label='Connection method'>
          <Select
            label='Connection method'
            value={method}
            options={methods.map((entry) => ({
              value: entry,
              label: ACCOUNT_METHOD_LABELS[entry],
            }))}
            onValueChange={(value) => {
              const selected = methods.find((entry) => entry === value)
              if (selected) setMethod(selected)
            }}
          />
        </FieldFrame>
      )}
      {account && <p data-type='T060'>{guidance}</p>}
    </Modal>
  )
}

export function PersonalAccounts({ provider, integration, onChange }: PersonalAccountsProps) {
  const [action, setAction] = useState<AccountAction | null>(null)
  if (!integration.accountMethods.length && !integration.accounts.length) return null
  return (
    <SettingsSection title='Your accounts'>
      {integration.accounts.map((account) => (
        <SettingsRow
          key={account.id}
          label={account.label}
          description={`${ACCOUNT_METHOD_LABELS[account.method]} · ${account.status === 'active' ? 'Connected' : 'Needs reconnection'}`}
        >
          <ActionMenu
            label={`Manage ${account.label}`}
            icon='I108'
            triggerSize='compact'
            tooltip={false}
            actions={[
              ...(account.permissions?.tools.length
                ? [
                    {
                      id: 'permissions',
                      label: 'Tool permissions',
                      onSelect: () => setAction({ kind: 'permissions', account }),
                    },
                  ]
                : []),
              ...(account.status === 'needs_reauth'
                ? [
                    {
                      id: 'reconnect',
                      label: 'Reconnect account',
                      onSelect: () => setAction({ kind: 'reconnect', account }),
                    },
                  ]
                : []),
              {
                id: 'disconnect',
                label: 'Disconnect account',
                destructive: true,
                separatorBefore: true,
                onSelect: () => setAction({ kind: 'disconnect', account }),
              },
            ]}
          />
        </SettingsRow>
      ))}
      {integration.accountMethods.length > 0 && (
        <SettingsRow
          label='Connect an account'
          description={`Use your own ${provider.name} permissions in Sim.`}
        >
          <Button size='compact' onClick={() => setAction({ kind: 'connect' })}>
            Connect
          </Button>
        </SettingsRow>
      )}
      {action?.kind === 'permissions' && action.account.permissions && (
        <ToolPermissions
          account={action.account}
          permissions={action.account.permissions}
          onClose={() => setAction(null)}
          onSave={(permissions) =>
            onChange({
              ...integration,
              accounts: integration.accounts.map((item) =>
                item.id === action.account.id ? { ...item, permissions } : item
              ),
            })
          }
        />
      )}
      {action?.kind === 'disconnect' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title='Disconnect account?'
          description={`Sim will lose access to ${action.account.label}. Other members’ accounts are unaffected.`}
          confirmLabel='Disconnect'
          destructive
          variant='confirm'
          onConfirm={() =>
            onChange({
              ...integration,
              accounts: integration.accounts.filter((item) => item.id !== action.account.id),
            })
          }
        />
      )}
      {(action?.kind === 'connect' || action?.kind === 'reconnect') && (
        <AuthorizationDialog
          provider={provider}
          methods={integration.accountMethods}
          slackStatus={integration.slackStatus}
          account={action.kind === 'reconnect' ? action.account : undefined}
          onClose={() => setAction(null)}
        />
      )}
    </SettingsSection>
  )
}
