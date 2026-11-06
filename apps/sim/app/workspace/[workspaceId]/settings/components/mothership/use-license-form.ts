'use client'

import { useState } from 'react'
import { type MothershipEnv, useGenerateLicense } from '@/hooks/queries/mothership-admin'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'

/** A new license's draft. Its key exists only here, once, until the admin dismisses it. */
export function useLicenseForm(environment: MothershipEnv) {
  const generateLicense = useGenerateLicense(environment)
  const [newName, setNewName] = useState('')
  const [newExpiry, setNewExpiry] = useState('')
  const [approvalReference, setApprovalReference] = useState('')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const resetForm = () => {
    setNewName('')
    setNewExpiry('')
    setApprovalReference('')
  }
  useSettingsUnsavedGuard({
    isDirty: Boolean(newName.trim() || newExpiry || approvalReference.trim() || generatedKey),
    navigationBlocked: generateLicense.isPending,
    onDiscard: () => {
      resetForm()
      setGeneratedKey(null)
    },
  })

  const handleGenerate = () => {
    if (!newName.trim() || !approvalReference.trim() || generateLicense.isPending || generatedKey)
      return
    generateLicense.mutate(
      {
        name: newName.trim(),
        approvalReference: approvalReference.trim(),
        ...(newExpiry ? { expirationDate: newExpiry } : {}),
      },
      {
        onSuccess: (result) => {
          setGeneratedKey(result.license_key)
          resetForm()
        },
      }
    )
  }

  return {
    approvalReference,
    generateLicense,
    generatedKey,
    handleGenerate,
    newExpiry,
    newName,
    setApprovalReference,
    setGeneratedKey,
    setNewExpiry,
    setNewName,
  }
}
