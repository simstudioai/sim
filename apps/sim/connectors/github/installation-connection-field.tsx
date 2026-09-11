import type { ReactNode } from 'react'
import { Chip, ChipCombobox, ChipModalField } from '@sim/emcn'
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
  children,
}: GitHubInstallationConnectionFieldProps) {
  return (
    <ChipModalField type='custom' title='GitHub'>
      {error && installations.length === 0 ? (
        <SettingsQueryErrorState
          error={error}
          fallback='Could not load GitHub connections'
          isRetrying={isFetching}
          onRetry={onRetry}
          variant='inline'
        />
      ) : installations.length > 1 ? (
        <ChipCombobox
          options={[
            ...installations.map((credential) => ({
              value: credential.id,
              label: credential.name || 'GitHub',
            })),
            {
              value: '__connect_github__',
              label: 'Connect GitHub',
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
          {isLoading
            ? 'Loading GitHub…'
            : installations.find((credential) => credential.id === credentialId)?.name ||
              'Connect GitHub'}
        </Chip>
      )}
      {children}
    </ChipModalField>
  )
}
