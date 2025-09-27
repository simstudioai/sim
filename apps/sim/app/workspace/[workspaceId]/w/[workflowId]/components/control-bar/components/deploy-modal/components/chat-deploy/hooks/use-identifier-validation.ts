import { useEffect, useState } from 'react'

export function useIdentifierValidation(
  identifier: string,
  originalIdentifier?: string,
  isEditingExisting?: boolean
) {
  const [error, setError] = useState<string | null>(null)
  const [isValid, setIsValid] = useState(false)

  useEffect(() => {
    // Reset states immediately when identifier changes
    setError(null)
    setIsValid(false)

    // Skip validation if empty
    if (!identifier.trim()) {
      return
    }

    // Skip validation if same as original (existing deployment)
    if (originalIdentifier && identifier === originalIdentifier) {
      setIsValid(true)
      return
    }

    // If we're editing an existing deployment but originalIdentifier isn't available yet,
    // assume it's valid and wait for the data to load
    if (isEditingExisting && !originalIdentifier) {
      setIsValid(true)
      return
    }

    // Validate format - only client-side validation needed now
    if (!/^[a-z0-9-]+$/.test(identifier)) {
      setError('Identifier can only contain lowercase letters, numbers, and hyphens')
      return
    }

    // If format is valid, mark as valid
    setIsValid(true)
  }, [identifier, originalIdentifier, isEditingExisting])

  // No longer need isChecking since we're not doing async validation
  return { isChecking: false, error, isValid }
}
