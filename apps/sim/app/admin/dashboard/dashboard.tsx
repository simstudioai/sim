'use client'

import { Suspense, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EnterpriseStatsCard } from '../components/enterprise-stats/enterprise-stats'
import { SystemStatsCard } from '../components/system-stats/system-stats'
import { UsageStatsCard } from '../components/usage-stats/usage-stats'
import { WaitlistStatsCard } from '../components/waitlist-stats/waitlist-stats'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <>
      <div className="mb-6 px-1">
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage Sim Studio platform settings and users.
        </p>
      </div>

      {/* Priority cards at the top */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Suspense fallback={<CardSkeleton />}>
          <SystemStatsCard />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <WaitlistStatsCard />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <EnterpriseStatsCard />
        </Suspense>
      </div>

      {/* Tabs for detailed metrics */}
      <Tabs
        defaultValue="overview"
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="usage">Usage Metrics</TabsTrigger>
          <TabsTrigger value="users">User Activity</TabsTrigger>
          <TabsTrigger value="platform">Platform Features</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <div className="space-y-6">
            <Suspense fallback={<CardSkeleton className="w-full" />}>
              <UsageStatsSection view="overview" />
            </Suspense>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="mt-0">
          <div className="space-y-6">
            <Suspense fallback={<CardSkeleton className="w-full" />}>
              <UsageStatsSection view="usage" />
            </Suspense>
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-0">
          <div className="space-y-6">
            <Suspense fallback={<CardSkeleton className="w-full" />}>
              <UsageStatsSection view="users" />
            </Suspense>
          </div>
        </TabsContent>

        <TabsContent value="platform" className="mt-0">
          <div className="space-y-6">
            <Suspense fallback={<CardSkeleton className="w-full" />}>
              <UsageStatsSection view="platform" />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}

// Use a wrapper component for UsageStatsCard to pass in the view
function UsageStatsSection({ view }: { view: 'overview' | 'usage' | 'users' | 'platform' }) {
  return <UsageStatsCard view={view} />
}

function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`border rounded-lg shadow-sm p-6 ${className} flex flex-col h-[320px]`}>
      <div className="flex-grow">
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-64 mb-6" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="space-y-2 mt-2">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>

        {/* Add spacer div */}
        <div className="h-6"></div>
      </div>
      <div className="mt-auto pt-6 border-t">
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  )
}
