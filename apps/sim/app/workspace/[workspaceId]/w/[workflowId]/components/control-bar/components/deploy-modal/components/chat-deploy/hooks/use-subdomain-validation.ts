import { useEffect, useRef, useState } from 'react'

export function useSubdomainValidation(subdomain: string, originalSubdomain?: string) {
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

    // Skip validation if empty or same as original
    if (!subdomain.trim()) {
      return
    }

    if (subdomain === originalSubdomain) {
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
  }, [subdomain, originalSubdomain])

  return { isChecking, error, isValid }
}
