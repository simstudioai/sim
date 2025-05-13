'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardCard, StatItem } from '../dashboard-card/dashboard-card'

interface EnterpriseStats {
  activePlans: number
  totalSeats: number
  revenue?: number
  loading: boolean
  error: string | null
}

export function EnterpriseStatsCard() {
  const [stats, setStats] = useState<EnterpriseStats>({
    activePlans: 0,
    totalSeats: 0,
    revenue: 0,
    loading: true,
    error: null,
  })

  useEffect(() => {
    async function fetchStats() {
      try {
        const token = sessionStorage.getItem('admin-auth-token') || ''
        const response = await fetch('/api/admin/subscriptions?stats=true', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-cache, must-revalidate',
          },
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error('Failed to load enterprise stats')
        }

        const data = await response.json()
        if (data.success) {
          // Extract enterprise stats from the response
          const enterpriseStats = data.stats.enterprise || {
            activePlans: 0,
            totalSeats: 0,
            revenue: 0,
          }

          setStats({
            activePlans: enterpriseStats.activePlans || 0,
            totalSeats: enterpriseStats.totalSeats || 0,
            revenue: enterpriseStats.revenue || 0,
            loading: false,
            error: null,
          })
        } else {
          throw new Error(data.message || 'Failed to load enterprise stats')
        }
      } catch (error) {
        console.error('Error fetching enterprise stats:', error)
        setStats((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
      }
    }

    fetchStats()
  }, [])

  if (stats.error) {
    return (
      <DashboardCard
        title="Enterprise Subscriptions"
        description="Error loading enterprise statistics"
      >
        <div className="flex flex-col h-full">
          <div className="text-red-500 p-4 flex-grow">{stats.error}</div>
        </div>
      </DashboardCard>
    )
  }

  const avgSeatsPerPlan =
    stats.activePlans > 0 ? Math.round(stats.totalSeats / stats.activePlans) : 0

  return (
    <DashboardCard title="Enterprise Subscriptions">
      <div className="flex flex-col h-full justify-between">
        <div className="flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatItem value={stats.activePlans} label="Active Plans" loading={stats.loading} />
            <StatItem value={stats.totalSeats} label="Total Seats" loading={stats.loading} />
          </div>

          {stats.loading ? (
            <div className="flex flex-col gap-2 mt-4">
              <div className="flex justify-between items-center text-sm">
                <span>Avg. Seats per Plan:</span>
                <Skeleton className="h-5 w-16" />
              </div>
              <div className="flex justify-between items-center text-sm">
                <span>Est. Monthly Revenue:</span>
                <Skeleton className="h-5 w-24" />
              </div>

              <div className="h-6"></div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 mt-4">
              <div className="flex justify-between items-center text-sm">
                <span>Avg. Seats per Plan:</span>
                <span className="font-semibold">{avgSeatsPerPlan}</span>
              </div>

              {stats.revenue !== undefined && (
                <div className="flex justify-between items-center text-sm">
                  <span>Est. Monthly Revenue:</span>
                  <span className="font-semibold">${stats.revenue.toLocaleString()}</span>
                </div>
              )}

              <div className="h-6"></div>
            </div>
          )}
        </div>

        <div className="mt-auto pt-6 border-t">
          {stats.loading ? (
            <Button variant="outline" size="sm" className="w-full" disabled>
              <Skeleton className="h-4 w-40" />
            </Button>
          ) : (
            <Link href="/admin/subscriptions" className="w-full">
              <Button variant="outline" size="sm" className="w-full">
                <ArrowRight className="mr-2 h-4 w-4" /> Manage Subscriptions
              </Button>
            </Link>
          )}
        </div>
      </div>
    </DashboardCard>
  )
}
