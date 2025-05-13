'use client'

import { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface DashboardCardProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function DashboardCard({ title, description, children, className }: DashboardCardProps) {
  return (
    <Card className={`overflow-hidden shadow-sm flex flex-col ${className}`}>
      <CardHeader className="pb-3 bg-muted/30">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {description && <CardDescription className="text-sm mt-1">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-5 flex-1 flex flex-col">{children}</CardContent>
    </Card>
  )
}

interface StatItemProps {
  value: string | number
  label: string
  description?: string
  loading?: boolean
}

export function StatItem({ value, label, description, loading = false }: StatItemProps) {
  return (
    <div className="bg-card rounded-md p-4 border shadow-sm hover:shadow-md transition-shadow">
      <div className="text-3xl font-bold">
        {loading ? <div className="h-8 w-16 bg-muted animate-pulse rounded-md" /> : value}
      </div>
      <div className="text-sm font-medium mt-1">{label}</div>
      {description && <div className="text-xs text-muted-foreground mt-2">{description}</div>}
    </div>
  )
}
