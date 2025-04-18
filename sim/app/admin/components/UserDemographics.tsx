'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, UserX, UserCheck, UserPlus } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Chart from './Chart'
import { ScrollArea } from '@/components/ui/scroll-area'

interface UserDemographicsProps {
  demographics: {
    totalUsers: number
    inactiveUsers: number
    inactivePercentage: number
    usersWithNoWorkflows: number
    usersWithNoRuns: number
    averageWorkflowsPerUser: number
    modifiedAndRan: number
    modifiedAndRanPercentage: number
    modifiedNoRun: number
    modifiedNoRunPercentage: number
    createdMultiple: number
    createdMultiplePercentage: number
    baseStateOnly: number
    baseStateOnlyPercentage: number
    totalSessions: number
    averageSessionsPerUser: number
    returningUsers: number
    returningUsersPercentage: number
    topReturningUsers: Array<{
      name: string
      email: string
      sessionCount: number
      lastSeen: string
    }>
  }
}

export default function UserDemographics({ demographics }: UserDemographicsProps) {
  const activeUsers = demographics.totalUsers - demographics.inactiveUsers
  const activePercentage = 100 - demographics.inactivePercentage

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          User Demographics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="engagement">Workflow Engagement</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Chart
                  type="doughnut"
                  data={{
                    labels: ['Active Users', 'Inactive Users'],
                    datasets: [
                      {
                        data: [activeUsers, demographics.inactiveUsers],
                        backgroundColor: [
                          'rgba(34, 197, 94, 0.5)',  // green for active
                          'rgba(239, 68, 68, 0.5)',  // red for inactive
                        ],
                        borderColor: [
                          'rgba(34, 197, 94, 0.8)',
                          'rgba(239, 68, 68, 0.8)',
                        ],
                        borderWidth: 1,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'bottom',
                      },
                    },
                  }}
                  height={200}
                />
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Total Users</span>
                    <span className="text-2xl font-bold">{demographics.totalUsers}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Active Users</span>
                    <span className="text-2xl font-bold text-green-600">{activeUsers}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Inactive Users</span>
                    <span className="text-2xl font-bold text-red-600">{demographics.inactiveUsers}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Avg Workflows/User</span>
                    <span className="text-2xl font-bold">{demographics.averageWorkflowsPerUser.toFixed(1)}</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Users with no workflows</span>
                    <span className="font-medium">{demographics.usersWithNoWorkflows}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Users with no runs</span>
                    <span className="font-medium">{demographics.usersWithNoRuns}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Active rate</span>
                    <span className="font-medium">{activePercentage.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="engagement" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-stretch">
                <div className="w-full flex flex-col justify-center">
                  <Chart
                    type="doughnut"
                    data={{
                      labels: [
                        'Modified & Ran',
                        'Modified, No Run',
                        'Created Multiple Workflows',
                        'Base State Only'
                      ],
                      datasets: [
                        {
                          data: [
                            demographics.modifiedAndRan,
                            demographics.modifiedNoRun,
                            demographics.createdMultiple,
                            demographics.baseStateOnly
                          ],
                          backgroundColor: [
                            'rgba(34, 197, 94, 0.5)',   // green
                            'rgba(234, 179, 8, 0.5)',   // yellow
                            'rgba(59, 130, 246, 0.5)',  // blue
                            'rgba(239, 68, 68, 0.5)',   // red
                          ],
                          borderColor: [
                            'rgba(34, 197, 94, 0.8)',
                            'rgba(234, 179, 8, 0.8)',
                            'rgba(59, 130, 246, 0.8)',
                            'rgba(239, 68, 68, 0.8)',
                          ],
                          borderWidth: 1,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'bottom',
                        },
                      },
                    }}
                    height={250}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-green-50 dark:bg-green-950/50">
                    <div className="space-y-1">
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">Modified & Ran</span>
                      <div className="text-xs text-green-600 dark:text-green-400">
                        Users who modified and ran their first workflow
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-green-700 dark:text-green-300">
                        {demographics.modifiedAndRanPercentage.toFixed(1)}%
                      </div>
                      <div className="text-sm text-green-600 dark:text-green-400">
                        {demographics.modifiedAndRan} users
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/50">
                    <div className="space-y-1">
                      <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Modified, No Run</span>
                      <div className="text-xs text-yellow-600 dark:text-yellow-400">
                        Users who modified but haven't run their workflow
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-yellow-700 dark:text-yellow-300">
                        {demographics.modifiedNoRunPercentage.toFixed(1)}%
                      </div>
                      <div className="text-sm text-yellow-600 dark:text-yellow-400">
                        {demographics.modifiedNoRun} users
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-950/50">
                    <div className="space-y-1">
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Created Multiple Workflows</span>
                      <div className="text-xs text-blue-600 dark:text-blue-400">
                        Users who have created more than one workflow
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-blue-700 dark:text-blue-300">
                        {demographics.createdMultiplePercentage.toFixed(1)}%
                      </div>
                      <div className="text-sm text-blue-600 dark:text-blue-400">
                        {demographics.createdMultiple} users
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-red-50 dark:bg-red-950/50">
                    <div className="space-y-1">
                      <span className="text-sm font-medium text-red-700 dark:text-red-300">Base State Only</span>
                      <div className="text-xs text-red-600 dark:text-red-400">
                        Users with only an unmodified starter workflow
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-red-700 dark:text-red-300">
                        {demographics.baseStateOnlyPercentage.toFixed(1)}%
                      </div>
                      <div className="text-sm text-red-600 dark:text-red-400">
                        {demographics.baseStateOnly} users
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Chart
                  type="doughnut"
                  data={{
                    labels: [
                      'Returning Users',
                      'Single Session Users'
                    ],
                    datasets: [
                      {
                        data: [
                          demographics.returningUsers,
                          demographics.totalUsers - demographics.returningUsers
                        ],
                        backgroundColor: [
                          'rgba(34, 197, 94, 0.5)',   // green
                          'rgba(239, 68, 68, 0.5)',   // red
                        ],
                        borderColor: [
                          'rgba(34, 197, 94, 0.8)',
                          'rgba(239, 68, 68, 0.8)',
                        ],
                        borderWidth: 1,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'bottom',
                      },
                    },
                  }}
                  height={250}
                />
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Total Sessions</span>
                    <span className="text-2xl font-bold">{demographics.totalSessions}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Avg Sessions/User</span>
                    <span className="text-2xl font-bold">{demographics.averageSessionsPerUser.toFixed(1)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Returning Users</span>
                    <span className="text-2xl font-bold text-green-600">{demographics.returningUsers}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-muted-foreground">Return Rate</span>
                    <span className="text-2xl font-bold">{demographics.returningUsersPercentage.toFixed(1)}%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Top Returning Users</h3>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2">
                      {demographics.topReturningUsers.map((user) => (
                        <div key={`${user.email}-${user.sessionCount}`} className="flex items-center justify-between p-2 rounded-lg bg-accent/50">
                          <div className="space-y-1">
                            <p className="text-sm font-medium leading-none capitalize">
                              {user.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {user.email}
                            </p>
                          </div>
                          <div className="text-sm font-medium">
                            {user.sessionCount} {user.sessionCount === 1 ? 'session' : 'sessions'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
} 