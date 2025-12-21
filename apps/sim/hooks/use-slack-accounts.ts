import { useCallback, useEffect, useState } from 'react'

interface SlackAccount {
  id: string
  accountId: string
  providerId: string
  displayName?: string
}

interface UseSlackAccountsResult {
  accounts: SlackAccount[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Fetches and manages connected Slack accounts for the current user.
 * @returns Object containing accounts array, loading state, error state, and refetch function
 */
export function useSlackAccounts(): UseSlackAccountsResult {
  const [accounts, setAccounts] = useState<SlackAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAccounts = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch('/api/auth/accounts?provider=slack')
      if (response.ok) {
        const data = await response.json()
        setAccounts(data.accounts || [])
      } else {
        const data = await response.json().catch(() => ({}))
        setError(data.error || 'Failed to load Slack accounts')
        setAccounts([])
      }
    } catch {
      setError('Failed to load Slack accounts')
      setAccounts([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAccounts()
  }, [])

  return { accounts, isLoading, error, refetch: fetchAccounts }
}
