import { useCallback, useEffect, useState } from 'react'
import { useDisplayNamesStore } from '@/stores/display-names/store'

/**
 * Hook to get display name for a credential ID
 * Automatically fetches if not cached
 */
export function useCredentialDisplay(credentialId: string | undefined, provider?: string) {
  const [isLoading, setIsLoading] = useState(false)

  // Select the actual cached value from the store (not just the getter)
  // This ensures the component re-renders when the cache is populated
  const displayName = useDisplayNamesStore(
    useCallback(
      (state) => {
        if (!credentialId || !provider) return null
        return state.cache.credentials[provider]?.[credentialId] || null
      },
      [credentialId, provider]
    )
  )

  // Fetch if not cached
  useEffect(() => {
    if (!credentialId || !provider || displayName || isLoading) return

    setIsLoading(true)
    fetch(`/api/auth/oauth/credentials?provider=${encodeURIComponent(provider)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.credentials) {
          const credentialMap = data.credentials.reduce(
            (acc: Record<string, string>, cred: { id: string; name: string }) => {
              acc[cred.id] = cred.name
              return acc
            },
            {}
          )
          useDisplayNamesStore.getState().setDisplayNames('credentials', provider, credentialMap)
        }
      })
      .catch(() => {
        // Silently fail
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [credentialId, provider, displayName, isLoading])

  return {
    displayName,
    isLoading,
  }
}
