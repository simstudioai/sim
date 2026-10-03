import type { ReactNode } from 'react'
import { Chip, ChipCombobox, ChipModalError, ChipModalField } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import type { Credential } from '@/lib/oauth'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

interface GitHubInstallationConnectionFieldProps {
  installations: Credential[]
  credentialId: string | null
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  disabled: boolean
  onRetry: () => void
  onConnect: () => void
  onChange: (credentialId: string) => void
  connecting?: boolean
  connectionError?: string | null
  hint?: string
  onCancel?: () => void
  onCheckConnection: () => void
  isChecking?: boolean
  children?: ReactNode
}

export function GitHubInstallationConnectionField({
  installations,
  credentialId,
  isLoading,
  isFetching,
  error,
  disabled,
  onRetry,
  onConnect,
  onChange,
  connecting = false,
  connectionError,
  hint,
  onCancel,
  onCheckConnection,
  isChecking = false,
  children,
}: GitHubInstallationConnectionFieldProps) {
  return (
    <ChipModalField type='custom' title='GitHub' hint={hint}>
      {connecting ? (
        <div className='flex items-center gap-2'>
          <Chip disabled={isChecking} onClick={onCheckConnection}>
            {isChecking ? 'Checking GitHub…' : 'Check connection'}
          </Chip>
          <Chip aria-label='Cancel GitHub connection' onClick={onCancel}>
            Cancel
          </Chip>
        </div>
      ) : error && installations.length === 0 ? (
        <SettingsQueryErrorState
          error={error}
          fallback='Could not load GitHub connections'
          isRetrying={isFetching}
          onRetry={onRetry}
          variant='inline'
        />
      ) : installations.length > 0 ? (
        <ChipCombobox
          aria-label='GitHub account'
          options={[
            ...installations.map((credential) => ({
              value: credential.id,
              label: credential.name || 'GitHub',
            })),
            {
              value: '__connect_github__',
              label: 'Connect another organization',
              icon: Plus,
              onSelect: onConnect,
            },
          ]}
          value={credentialId ?? undefined}
          onChange={onChange}
          placeholder='Select GitHub connection'
          disabled={disabled}
        />
      ) : (
        <Chip disabled={disabled || isLoading} onClick={onConnect}>
          {isLoading ? 'Loading GitHub…' : 'Connect GitHub'}
        </Chip>
      )}
      <ChipModalError>{connectionError}</ChipModalError>
      {children}
    </ChipModalField>
  )
}
