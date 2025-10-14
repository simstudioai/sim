'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Logs from '@/app/workspace/[workspaceId]/logs/logs'
import ExecutionsDashboard from '@/app/workspace/[workspaceId]/logs/executions-dashboard'

export default function LogsWrapper() {
  const [activeView, setActiveView] = useState<'logs' | 'dashboard'>('logs')

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4 pl-64">
        <Tabs value={activeView} onValueChange={(value) => setActiveView(value as 'logs' | 'dashboard')}>
          <TabsList>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="dashboard">Executions Dashboard</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {activeView === 'logs' ? <Logs /> : <ExecutionsDashboard />}
      </div>
    </div>
  )
}

