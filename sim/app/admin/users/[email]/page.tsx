import { Metadata } from 'next'
import { UserStatsCard } from '@/components/user-stats-card'

export const metadata: Metadata = {
  title: 'User Statistics | Sim Studio',
  description: 'View user statistics and analytics',
}

interface PageProps {
  params: {
    email: string
  }
}

export default async function UserStatsPage({ params }: PageProps) {
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

  const data = await response.json()

  return (
    <div className="container mx-auto py-8">
      <UserStatsCard
        firstName={data.firstName}
        workflows={data.workflows}
        blockUsage={data.blockUsage}
        apiUsage={data.apiUsage}
        totalBlocks={data.totalBlocks}
        avgBlocksPerWorkflow={data.avgBlocksPerWorkflow}
      />
    </div>
  )
} 