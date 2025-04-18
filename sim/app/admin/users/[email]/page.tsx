'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { UserStatsCard } from '@/components/user-stats-card'

export default function UserStatsPage() {
  const params = useParams<{ email: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // If no params are available, show error
  if (!params?.email) {
    return <div className="container mx-auto py-8 text-red-500">Invalid user email</div>
  }

  useEffect(() => {
    const fetchUserStats = async () => {
      try {
        const response = await fetch(
          `/api/admin/users/${encodeURIComponent(params.email)}/stats`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )

        if (!response.ok) {
          throw new Error('Failed to fetch user statistics')
        }

        const userData = await response.json()
        setData(userData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchUserStats()
  }, [params.email])

  if (loading) {
    return <div className="container mx-auto py-8">Loading...</div>
  }

  if (error) {
    return <div className="container mx-auto py-8 text-red-500">{error}</div>
  }

  if (!data) {
    return <div className="container mx-auto py-8">No data available</div>
  }

  return (
    <div className="container mx-auto py-8">
      <UserStatsCard
        firstName={data.firstName}
        workflows={data.workflows}
        blockUsage={data.blockUsage}
        totalBlocks={data.totalBlocks}
        avgBlocksPerWorkflow={data.avgBlocksPerWorkflow}
        totalCost={data.totalCost}
      />
    </div>
  )
}

// Metadata can be moved to a separate layout.tsx file if needed
// since this is now a client component 