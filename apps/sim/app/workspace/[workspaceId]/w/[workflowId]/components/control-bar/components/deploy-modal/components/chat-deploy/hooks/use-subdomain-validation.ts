import { useEffect, useRef, useState } from 'react'

export function useSubdomainValidation(
  subdomain: string,
  originalSubdomain?: string,
  isEditingExisting?: boolean
) {
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isValid, setIsValid] = useState(false)

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Reset states immediately when subdomain changes
    setError(null)
    setIsValid(false)
    setIsChecking(false)

    // Skip validation if empty
    if (!subdomain.trim()) {
      return
    }

    // Skip validation if same as original (existing deployment)
    if (originalSubdomain && subdomain === originalSubdomain) {
      setIsValid(true)
      return
    }

    // If we're editing an existing deployment but originalSubdomain isn't available yet,
    // assume it's valid and wait for the data to load
    if (isEditingExisting && !originalSubdomain) {
      setIsValid(true)
      return
    }

    // Validate format first
    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      setError('Subdomain can only contain lowercase letters, numbers, and hyphens')
      return
    }

    // Debounce API call
    setIsChecking(true)
    timeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/chat/subdomains/validate?subdomain=${encodeURIComponent(subdomain)}`
        )
        const data = await response.json()

        if (!response.ok || !data.available) {
          setError(data.error || 'This subdomain is already in use')
          setIsValid(false)
        } else {
          setError(null)
          setIsValid(true)
        }
      } catch (error) {
        setError('Error checking subdomain availability')
        setIsValid(false)
      } finally {
        setIsChecking(false)
      }
    }, 500)

    // Cleanup function
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [subdomain, originalSubdomain, isEditingExisting])

  return { isChecking, error, isValid }
}
