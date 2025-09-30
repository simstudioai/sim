import { useEffect, useRef, useState } from 'react'

export function useIdentifierValidation(
  identifier: string,
  originalIdentifier?: string,
  isEditingExisting?: boolean
) {
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isValid, setIsValid] = useState(false)

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Reset states immediately when identifier changes
    setError(null)
    setIsValid(false)
    setIsChecking(false)

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

    // Validate format first - client-side validation
    if (!/^[a-z0-9-]+$/.test(identifier)) {
      setError('Identifier can only contain lowercase letters, numbers, and hyphens')
      return
    }

    // Check availability with server
    setIsChecking(true)
    timeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/chat/validate?identifier=${encodeURIComponent(identifier)}`
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
      } catch (error) {
        setError('Error checking identifier availability')
        setIsValid(false)
      } finally {
        setIsChecking(false)
      }
    }, 500)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [identifier, originalIdentifier, isEditingExisting])

  return { isChecking, error, isValid }
}
