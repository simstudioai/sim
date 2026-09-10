'use client'

import { useState } from 'react'
import {
  Chip,
  ChipCombobox,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { PersonalSourceSetupQuery } from '@/lib/api/contracts/knowledge/personal-source-setup'
import type { SearchConnector } from '@/lib/sim-search/connectors'
import { MAX_PERSONAL_SOURCE_SETUP_KEYS } from '@/lib/sim-search/personal-source-setup'
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/connector-selector-field'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useConnectPersonalSourceSetup } from '@/hooks/queries/personal-source-setup'
import { usePersonalSourceAccount } from '@/hooks/use-personal-source-account'

interface AtlassianSourceSetupModalProps {
  organizationId: string
  connector: SearchConnector
  connectorType: PersonalSourceSetupQuery['connectorType']
  onClose: () => void
  onConnected?: (connection: { connectorId: string; credentialId: string }) => void
}

export function AtlassianSourceSetupModal({
  organizationId,
  connector,
  connectorType,
  onClose,
  onConnected,
}: AtlassianSourceSetupModalProps) {
  const [selectedAccount, setSelectedAccount] = useState<string>()
  const account = usePersonalSourceAccount({
    organizationId,
    connectorType,
    onConnected: (id) => {
      setSelectedAccount(id)
      config.setSourceConfig((previous) => ({ domain: previous.domain ?? '' }))
    },
  })
  const { mutateAsync: connect, isPending } = useConnectPersonalSourceSetup()
  const config = useConnectorConfigFields({
    connectorConfig: connector.meta,
    accessMode: 'members',
  })
  const accounts = account.accounts.data?.accounts ?? []
  const requestedAccount =
    selectedAccount ??
    account.accounts.data?.completedCredentialId ??
    (accounts.length === 1 ? accounts[0].id : undefined)
  const credentialId = accounts.find((item) => item.id === requestedAccount)?.id ?? null
  const canonicalId = connectorType === 'jira' ? 'projectKey' : 'spaceKey'
  const picker = connector.meta.configFields.find(
    (field) => field.canonicalParamId === canonicalId && field.type === 'selector'
  )!
  const manual = connector.meta.configFields.find((field) => field.id === canonicalId)!
  const advanced = config.canonicalModes[canonicalId] === 'advanced'
  const domain = typeof config.sourceConfig.domain === 'string' ? config.sourceConfig.domain : ''
  const resolved = config.resolveSourceConfig()[canonicalId]
  const manualValue = config.sourceConfig[canonicalId]
  const keys = Array.isArray(resolved)
    ? resolved
        .filter((key): key is string => typeof key === 'string' && Boolean(key.trim()))
        .map((key) => key.trim())
    : []
  const pending = isPending || account.pending
  const close = () => {
    if (!isPending) onClose()
  }
  const chooseAccount = (id: string) => {
    if (id === credentialId) return
    setSelectedAccount(id)
    config.setSourceConfig({ domain })
  }
  const addAccount = () => {
    void account.connect()
  }
  const submit = async () => {
    if (!credentialId || !domain.trim() || !keys.length || pending) return
    if (keys.length > MAX_PERSONAL_SOURCE_SETUP_KEYS) {
      toast.error('Choose no more than 1,000 projects or spaces per source.')
      return
    }
    try {
      const result = await connect({
        action: 'connect',
        organizationId,
        connectorType,
        credentialId,
        domain: domain.trim(),
        keys,
      })
      onConnected?.({ connectorId: result.connectorId, credentialId })
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not connect the source'))
    }
  }

  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
      srTitle={`Connect ${connector.meta.name}`}
    >
      <ChipModalHeader onClose={close}>Connect {connector.meta.name}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='custom'
          title='Your account'
          required
          hint='Choose the Atlassian account matching your Sim email address.'
        >
          {(aria) => (
            <>
              {accounts.length > 0 && (
                <ChipCombobox
                  {...aria}
                  aria-label='Your account'
                  value={credentialId ?? ''}
                  onChange={chooseAccount}
                  options={accounts.map((item) => ({ value: item.id, label: item.name }))}
                  placeholder='Select your account'
                  disabled={pending}
                />
              )}
              <div className='flex items-center gap-2'>
                <Chip onClick={addAccount} disabled={pending || account.accounts.isPending}>
                  {account.pending
                    ? 'Waiting for authorization…'
                    : accounts.length
                      ? 'Connect another account'
                      : 'Connect account'}
                </Chip>
                {account.pending && <Chip onClick={account.cancel}>Cancel</Chip>}
              </div>
              {account.accounts.isPending && (
                <p className='text-[var(--text-muted)] text-caption'>Loading accounts…</p>
              )}
              {account.accounts.isError && (
                <Chip onClick={() => void account.accounts.refetch()}>Retry loading accounts</Chip>
              )}
            </>
          )}
        </ChipModalField>
        {credentialId && !account.pending && (
          <>
            <ChipModalField
              type='input'
              title='Atlassian site'
              value={domain}
              onChange={(value) => config.handleFieldChange('domain', value)}
              placeholder='yoursite.atlassian.net'
              autoComplete='off'
              required
              disabled={isPending}
            />
            <ChipModalField type='custom' title={advanced ? manual.title : picker.title} required>
              {(aria) => (
                <>
                  {advanced ? (
                    <ChipInput
                      {...aria}
                      aria-label={manual.title}
                      value={
                        Array.isArray(manualValue) ? manualValue.join(', ') : (manualValue ?? '')
                      }
                      onChange={(event) =>
                        config.handleFieldChange(canonicalId, event.target.value)
                      }
                      placeholder={manual.placeholder}
                      disabled={isPending}
                    />
                  ) : picker.selectorKey ? (
                    <ConnectorSelectorField
                      controlAria={aria}
                      key={`${credentialId}:${domain}`}
                      scope={{ kind: 'organization', organizationId }}
                      selectorSurface={{
                        kind: 'personal-search-setup',
                        organizationId,
                        connectorType,
                      }}
                      field={{ ...picker, selectorKey: picker.selectorKey }}
                      value={config.sourceConfig[picker.id] ?? []}
                      onChange={(value, labels) =>
                        config.handleFieldChange(picker.id, value, labels)
                      }
                      credentialId={credentialId}
                      sourceConfig={config.sourceConfig}
                      configFields={connector.meta.configFields}
                      canonicalModes={config.canonicalModes}
                      selectedLabels={config.selectionLabels[canonicalId]}
                      disabled={isPending}
                    />
                  ) : null}
                  <Chip
                    onClick={() => config.toggleCanonicalMode(canonicalId)}
                    disabled={isPending}
                  >
                    {advanced
                      ? `Choose ${connectorType === 'jira' ? 'projects' : 'spaces'} from list`
                      : 'Enter keys manually'}
                  </Chip>
                </>
              )}
            </ChipModalField>
          </>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        secondaryActions={
          connector.meta.searchDocsUrl
            ? [
                {
                  label: 'Setup guide',
                  onClick: () =>
                    window.open(connector.meta.searchDocsUrl, '_blank', 'noopener,noreferrer'),
                },
              ]
            : undefined
        }
        primaryAction={{
          label: isPending ? 'Connecting…' : 'Connect & Sync',
          onClick: () => void submit(),
          disabled: !credentialId || !domain.trim() || !keys.length || pending,
        }}
      />
    </ChipModal>
  )
}
