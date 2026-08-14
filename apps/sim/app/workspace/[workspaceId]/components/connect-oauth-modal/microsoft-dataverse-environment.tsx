'use client'

import { useState } from 'react'
import { ChipModalField } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import {
  getMicrosoftDataverseOAuthScopes,
  MICROSOFT_DATAVERSE_PROVIDER_ID,
  normalizeMicrosoftDataverseEnvironmentUrl,
} from '@/lib/oauth/microsoft-dataverse'

const DYNAMICS_IDENTITY_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const

interface UseMicrosoftDataverseEnvironmentFormProps {
  fallbackScopes: readonly string[]
  lockedEnvironmentUrl?: string
  open: boolean
  providerId: string
  required: boolean
}

export interface MicrosoftDataverseEnvironmentForm {
  effectiveScopes: readonly string[]
  enabled: boolean
  error: string | null
  isComplete: boolean
  isLocked: boolean
  setValue: (value: string) => void
  validate: () => string | undefined
  value: string
}

export function useMicrosoftDataverseEnvironmentForm({
  fallbackScopes,
  lockedEnvironmentUrl,
  open,
  providerId,
  required,
}: UseMicrosoftDataverseEnvironmentFormProps): MicrosoftDataverseEnvironmentForm {
  const enabled = required && providerId === MICROSOFT_DATAVERSE_PROVIDER_ID
  const initialValue = enabled ? (lockedEnvironmentUrl ?? '') : ''
  const [value, setEnvironmentValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const sessionKey = `${open}:${enabled}:${lockedEnvironmentUrl ?? ''}`
  const [previousSessionKey, setPreviousSessionKey] = useState(sessionKey)

  if (previousSessionKey !== sessionKey) {
    setPreviousSessionKey(sessionKey)
    setEnvironmentValue(open && enabled ? (lockedEnvironmentUrl ?? '') : '')
    setError(null)
  }

  const setValue = (nextValue: string) => {
    setEnvironmentValue(nextValue)
    setError(null)
  }

  const validate = () => {
    if (!enabled) return undefined
    try {
      const environmentUrl = normalizeMicrosoftDataverseEnvironmentUrl(value)
      setError(null)
      return environmentUrl
    } catch (validationError) {
      setError(
        getErrorMessage(validationError, 'Enter a valid public-cloud Dataverse environment URL.')
      )
      return undefined
    }
  }

  const effectiveScopes = (() => {
    if (!enabled) return fallbackScopes
    if (!value.trim()) return DYNAMICS_IDENTITY_SCOPES
    try {
      return getMicrosoftDataverseOAuthScopes(value)
    } catch {
      return fallbackScopes
    }
  })()

  return {
    effectiveScopes,
    enabled,
    error,
    isComplete: !enabled || value.trim().length > 0,
    isLocked: enabled && Boolean(lockedEnvironmentUrl),
    setValue,
    validate,
    value,
  }
}

interface MicrosoftDataverseEnvironmentFieldProps {
  form: MicrosoftDataverseEnvironmentForm
}

export function MicrosoftDataverseEnvironmentField({
  form,
}: MicrosoftDataverseEnvironmentFieldProps) {
  if (!form.enabled) return null

  if (form.isLocked) {
    return (
      <ChipModalField
        type='copy'
        title='Environment URL'
        value={form.value}
        copyLabel='Copy environment URL'
        required
        error={form.error ?? undefined}
        hint='This connection is locked to the environment selected by the workflow or credential.'
      />
    )
  }

  return (
    <ChipModalField
      type='input'
      inputType='url'
      title='Environment URL'
      value={form.value}
      onChange={form.setValue}
      placeholder='https://myorg.crm.dynamics.com'
      autoComplete='off'
      required
      error={form.error ?? undefined}
      hint='This credential is restricted to one public-cloud Dataverse environment.'
    />
  )
}
