'use client'

import { useState } from 'react'
import {
  Chip,
  ChipCombobox,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useConnectGitHubSearchInstallation,
  useGitHubSearchInstallations,
} from '@/hooks/queries/github-search-installations'
import {
  useConnectOrganizationAccount,
  useEnsureOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

interface GitHubInstallationModalProps {
  organizationId: string
  onClose: () => void
  onConnected: (credentialId: string) => void
}

/** Installs a content account while preserving each reader's own GitHub authorization. */
export function GitHubInstallationModal({
  organizationId,
  onClose,
  onConnected,
}: GitHubInstallationModalProps) {
  const installations = useGitHubSearchInstallations(organizationId)
  const connectInstallation = useConnectGitHubSearchInstallation()
  const ensureAccounts = useEnsureOrganizationAccounts()
  const connectAccount = useConnectOrganizationAccount()
  const [installationId, setInstallationId] = useState<string | null>(null)
  const [waitingForAccount, setWaitingForAccount] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const data = installations.isSuccess ? installations.data : undefined
  const choices = data?.installations ?? []
  const selected =
    choices.find((item) => item.installationId === installationId) ??
    (choices.length === 1 ? choices[0] : undefined)
  const pending =
    connectInstallation.isPending || ensureAccounts.isPending || connectAccount.isPending
  const canConnect =
    data?.available === true &&
    !data.needsUserConnection &&
    selected !== undefined &&
    !installations.isFetching &&
    !pending

  const connectGitHubAccount = () => {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setConnectionError('Allow pop-ups for this site to connect your GitHub account.')
      return
    }
    tab.opener = null
    setConnectionError(null)
    ensureAccounts.mutate(
      {
        organizationId,
        option: { provider: 'github-repositories', label: 'GitHub', required: false },
      },
      {
        onSuccess: ({ credentialGroup }) => {
          const option = credentialGroup.options.find(
            (item) => item.provider === 'github-repositories' && item.status === 'active'
          )
          if (!option) {
            tab.close()
            setConnectionError('GitHub account setup is unavailable. Refresh and try again.')
            return
          }
          if (tab.closed) return
          connectAccount.mutate(
            { organizationId, optionId: option.id },
            {
              onSuccess: ({ invitationLink }) => {
                if (tab.closed) return
                tab.location.href = invitationLink
                setWaitingForAccount(true)
              },
              onError: () => tab.close(),
            }
          )
        },
        onError: () => tab.close(),
      }
    )
  }

  return (
    <ChipModal
      open
      srTitle='Connect GitHub'
      dismissDisabled={pending}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <ChipModalHeader onClose={onClose}>Connect GitHub</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='custom'
          title={data?.needsUserConnection ? 'GitHub account' : 'Installation'}
          hint={
            data?.available && !data.needsUserConnection && choices.length === 0
              ? 'Install the app, then refresh.'
              : undefined
          }
        >
          {(aria) =>
            installations.isError ? (
              <SettingsQueryErrorState
                error={installations.error}
                fallback='Could not load GitHub installations'
                isRetrying={installations.isFetching}
                onRetry={() => void installations.refetch()}
                variant='inline'
              />
            ) : !data ? (
              <SettingsEmptyState variant='inline'>Loading GitHub setup…</SettingsEmptyState>
            ) : !data.available ? (
              <SettingsEmptyState variant='inline'>
                GitHub App indexing is unavailable in this deployment.
              </SettingsEmptyState>
            ) : data.needsUserConnection ? (
              <div className='flex flex-col gap-3'>
                <p className='text-[var(--text-body)] text-small'>
                  {waitingForAccount
                    ? 'Finish connecting your account in the other tab, then refresh.'
                    : 'Connect your GitHub account to verify the installations you can manage.'}
                </p>
                <div className='flex flex-wrap gap-2'>
                  <Chip variant='primary' disabled={pending} onClick={connectGitHubAccount}>
                    {waitingForAccount ? 'Open account connection' : 'Connect your GitHub account'}
                  </Chip>
                  <Chip
                    disabled={pending || installations.isFetching}
                    onClick={() => void installations.refetch()}
                  >
                    Refresh
                  </Chip>
                </div>
              </div>
            ) : (
              <div className='flex flex-col gap-3'>
                {choices.length > 0 ? (
                  <ChipCombobox
                    {...aria}
                    aria-label='Installation'
                    options={choices.map((item) => ({
                      value: item.installationId,
                      label: item.accountLogin,
                    }))}
                    value={selected?.installationId}
                    onChange={setInstallationId}
                    placeholder='Select an installation'
                    disabled={pending || installations.isFetching}
                  />
                ) : (
                  <SettingsEmptyState variant='inline'>
                    No eligible installations found.
                  </SettingsEmptyState>
                )}
                <div className='flex flex-wrap gap-2'>
                  {data.installUrl && (
                    <ChipLink
                      {...aria}
                      href={data.installUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      Install GitHub App
                    </ChipLink>
                  )}
                  <Chip
                    {...aria}
                    disabled={pending || installations.isFetching}
                    onClick={() => void installations.refetch()}
                  >
                    Refresh
                  </Chip>
                </div>
              </div>
            )
          }
        </ChipModalField>
        <ChipModalError>
          {connectionError ??
            ensureAccounts.error?.message ??
            connectAccount.error?.message ??
            connectInstallation.error?.message}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: connectInstallation.isPending ? 'Connecting…' : 'Use installation',
          disabled: !canConnect,
          onClick: () => {
            if (!canConnect || !selected) return
            connectInstallation.mutate(
              { organizationId, installationId: selected.installationId },
              { onSuccess: ({ credential }) => onConnected(credential.id) }
            )
          },
        }}
      />
    </ChipModal>
  )
}
