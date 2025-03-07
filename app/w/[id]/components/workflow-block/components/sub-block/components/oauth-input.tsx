'use client'

import { useEffect, useState } from 'react'
import { OAuthProvider } from '@/tools/types'
import { CredentialSelector } from './credential-selector'

interface OAuthInputProps {
  value: string
  onChange: (value: string) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
}

export function OAuthInput({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label,
  disabled = false,
  serviceId,
}: OAuthInputProps) {
  return (
    <div className="space-y-2">
      <CredentialSelector
        value={value}
        onChange={onChange}
        provider={provider}
        requiredScopes={requiredScopes}
        label={label || `Select ${provider} account`}
        disabled={disabled}
        serviceId={serviceId}
      />
    </div>
  )
}
