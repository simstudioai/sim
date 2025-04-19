'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { UserStatsCard } from '@/app/admin/dashboard/components/user-stats/user-stats-card'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export default function UserStatsPage() {
  const params = useParams<{ email: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  // If no params are available, show error
  if (!params?.email) {
    return (
      <div className="container mx-auto py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Invalid user email</AlertDescription>
        </Alert>
      </div>
    )
  }

  const fetchUserStats = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(params.email)}/stats`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          // Add cache: 'no-store' to prevent caching
          cache: 'no-store',
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch user statistics')
      }

      const userData = await response.json()
      setData(userData)
    } catch (err) {
      console.error('Error fetching user stats:', err)
      setError(err instanceof Error ? err.message : 'An error occurred while fetching user statistics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUserStats()
  }, [params.email])

  const handleRetry = () => {
    setRetryCount(prev => prev + 1)
    fetchUserStats()
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Loading user statistics...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={handleRetry} variant="outline">
          Retry
        </Button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="container mx-auto py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Data</AlertTitle>
          <AlertDescription>No user statistics available</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Process the data to ensure all required props are available
  const processedData = {
    firstName: data.user?.name || params.email.split('@')[0],
    workflows: data.workflows || [],
    blockUsage: data.blockUsage || [],
    totalBlocks: data.stats?.blockCount || 0,
    avgBlocksPerWorkflow: data.workflows?.length > 0 
      ? (data.stats?.blockCount || 0) / data.workflows.length 
      : 0,
    totalCost: data.stats?.totalCost || 0
  }

  return (
    <div className="container mx-auto py-8">
      <UserStatsCard
        firstName={processedData.firstName}
        workflows={processedData.workflows}
        blockUsage={processedData.blockUsage}
        totalBlocks={processedData.totalBlocks}
        avgBlocksPerWorkflow={processedData.avgBlocksPerWorkflow}
        totalCost={processedData.totalCost}
      />
    </div>
  )
}

// Metadata can be moved to a separate layout.tsx file if needed
// since this is now a client component 