'use client'

import type { ReactNode } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { Credential } from '@/lib/oauth'
import {
  Button,
  FailureNotice,
  FieldFrame,
  InlineNotice,
  SearchableSelect,
} from '@/platform/design-system/components'
import { ActionRow } from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'

interface GitHubConnectionFieldProps {
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

export function GitHubConnectionField({
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
}: GitHubConnectionFieldProps) {
  return (
    <FieldFrame label='GitHub' hint={installations.length > 0 ? undefined : hint}>
      {connecting ? (
        <ActionRow>
          <Button size='compact' disabled={isChecking} onClick={onCheckConnection}>
            {isChecking ? 'Checking GitHub…' : 'Check connection'}
          </Button>
          <Button size='compact' variant='quiet' onClick={onCancel}>
            Cancel
          </Button>
        </ActionRow>
      ) : error && installations.length === 0 ? (
        <FailureNotice
          message={getErrorMessage(error, 'Could not load GitHub connections')}
          retrying={isFetching}
          onRetry={onRetry}
        />
      ) : installations.length > 0 ? (
        <SearchableSelect
          label='GitHub account'
          labelHidden
          searchLabel='Search GitHub connections'
          placeholder='Select GitHub connection'
          options={installations.map((credential) => ({
            value: credential.id,
            label: credential.name || 'GitHub',
          }))}
          value={credentialId}
          onValueChange={(value) => {
            if (value) onChange(value)
          }}
          createLabel='Connect another organization'
          onCreate={onConnect}
          disabled={disabled}
          hint={hint}
        />
      ) : (
        <div>
          <Button size='compact' disabled={disabled || isLoading} onClick={onConnect}>
            {isLoading ? 'Loading GitHub…' : 'Connect GitHub'}
          </Button>
        </div>
      )}
      {connectionError && <InlineNotice intent='danger' message={connectionError} />}
      {children}
    </FieldFrame>
  )
}
