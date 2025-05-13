'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardCard, StatItem } from '../dashboard-card/dashboard-card'

interface WaitlistStats {
  pending: number
  approved: number
  rejected: number
  total: number
  loading: boolean
  error: string | null
}

export function WaitlistStatsCard() {
  const [stats, setStats] = useState<WaitlistStats>({
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
    loading: true,
    error: null,
  })

  useEffect(() => {
    async function fetchStats() {
      try {
        const token = sessionStorage.getItem('admin-auth-token') || ''
        const response = await fetch('/api/admin/waitlist/stats', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error('Failed to load waitlist stats')
        }

        const data = await response.json()
        if (data.success) {
          setStats({
            pending: data.stats.pending || 0,
            approved: data.stats.approved || 0,
            rejected: data.stats.rejected || 0,
            total: data.stats.total || 0,
            loading: false,
            error: null,
          })
        } else {
          throw new Error(data.message || 'Failed to load waitlist stats')
        }
      } catch (error) {
        console.error('Error fetching waitlist stats:', error)
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
      <DashboardCard title="Waitlist Stats" description="Error loading waitlist statistics">
        <div className="flex flex-col h-full">
          <div className="text-red-500 p-4 flex-grow">{stats.error}</div>
        </div>
      </DashboardCard>
    )
  }

  return (
    <DashboardCard title="Waitlist Stats">
      <div className="flex flex-col h-full justify-between">
        <div className="flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatItem value={stats.pending} label="Pending" loading={stats.loading} />
            <StatItem value={stats.approved} label="Approved" loading={stats.loading} />
          </div>

          {stats.loading ? (
            <div className="flex flex-col gap-2 mt-4">
              <div className="flex justify-between items-center text-sm">
                <span>Total Users:</span>
                <Skeleton className="h-5 w-20" />
              </div>
              <div className="flex justify-between items-center text-sm">
                <span>Approval Rate:</span>
                <Skeleton className="h-5 w-16" />
              </div>

              <div className="h-6"></div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 mt-4">
              <div className="flex justify-between items-center text-sm">
                <span>Total Users:</span>
                <span className="font-semibold">{stats.total}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span>Approval Rate:</span>
                <span className="font-semibold">
                  {stats.total > 0 ? `${Math.round((stats.approved / stats.total) * 100)}%` : '0%'}
                </span>
              </div>

              <div className="h-6"></div>
            </div>
          )}
        </div>

        <div className="mt-auto pt-6 border-t">
          {stats.loading ? (
            <Button variant="outline" size="sm" className="w-full" disabled>
              <Skeleton className="h-4 w-32" />
            </Button>
          ) : (
            <Link href="/admin/waitlist" className="w-full">
              <Button variant="outline" size="sm" className="w-full">
                <ArrowRight className="mr-2 h-4 w-4" /> Manage Waitlist
              </Button>
            </Link>
          )}
        </div>
      </div>
    </DashboardCard>
  )
}
