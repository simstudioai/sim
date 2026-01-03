import { useEffect, useRef, useState } from 'react'

const IDENTIFIER_PATTERN = /^[a-z0-9-]+$/
const DEBOUNCE_MS = 500

interface IdentifierValidationState {
  isChecking: boolean
  error: string | null
  isValid: boolean
}

/**
 * Hook for validating form identifier availability with debounced API checks
 * @param identifier - The identifier to validate
 * @param originalIdentifier - The original identifier when editing an existing form
 * @param isEditingExisting - Whether we're editing an existing form deployment
 */
export function useIdentifierValidation(
  identifier: string,
  originalIdentifier?: string,
  isEditingExisting?: boolean
): IdentifierValidationState {
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isValid, setIsValid] = useState(false)

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    setError(null)
    setIsValid(false)
    setIsChecking(false)

    if (!identifier.trim()) {
      return
    }

    if (originalIdentifier && identifier === originalIdentifier) {
      setIsValid(true)
      return
    }

    if (isEditingExisting && !originalIdentifier) {
      setIsValid(true)
      return
    }

    if (!IDENTIFIER_PATTERN.test(identifier)) {
      setError('Identifier can only contain lowercase letters, numbers, and hyphens')
      return
    }

    setIsChecking(true)
    timeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/form/validate?identifier=${encodeURIComponent(identifier)}`
        )
        const data = await response.json()

        if (!response.ok) {
          setError('Error checking identifier availability')
          setIsValid(false)
        } else if (!data.available) {
          setError(data.error || 'This identifier is already in use')
          setIsValid(false)
        } else {
          setError(null)
          setIsValid(true)
        }
      } catch {
        setError('Error checking identifier availability')
        setIsValid(false)
      } finally {
        setIsChecking(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [identifier, originalIdentifier, isEditingExisting])

  return { isChecking, error, isValid }
}
