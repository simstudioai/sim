import { useState, useCallback, useEffect } from 'react'

interface UserStats {
  user?: {
    name?: string
  }
  workflows?: any[]
  blockUsage?: any[]
  stats?: {
    blockCount?: number
    totalCost?: number
  }
}

export async function fetchUserStats(email: string) {
  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(email)}/stats`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch user statistics')
  }

  return response.json()
}

export function processUserData(data: UserStats, email: string) {
  const workflows = data.workflows || []
  return {
    firstName: data.user?.name || email.split('@')[0],
    workflows,
    blockUsage: data.blockUsage || [],
    totalBlocks: data.stats?.blockCount || 0,
    avgBlocksPerWorkflow: workflows.length > 0 
      ? (data.stats?.blockCount || 0) / workflows.length 
      : 0,
    totalCost: data.stats?.totalCost || 0
  }
}

interface UseUserStatsResult {
  loading: boolean
  error: string | null
  data: any
  handleRetry: () => void
  processedData: ReturnType<typeof processUserData> | null
}

export function useUserStats(email: string | undefined): UseUserStatsResult {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const loadUserStats = useCallback(async () => {
    if (!email) return
    
    try {
      setLoading(true)
      setError(null)
      const userData = await fetchUserStats(email)
      setData(userData)
    } catch (err) {
      console.error('Error fetching user stats:', err)
      setError(err instanceof Error ? err.message : 'An error occurred while fetching user statistics')
    } finally {
      setLoading(false)
    }
  }, [email])

  useEffect(() => {
    loadUserStats()
  }, [loadUserStats])

  const handleRetry = () => {
    setRetryCount(prev => prev + 1)
    loadUserStats()
  }

  const processedData = data ? processUserData(data, email || '') : null

  return {
    loading,
    error,
    data,
    handleRetry,
    processedData
  }
} 