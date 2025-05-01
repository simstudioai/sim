import { Metadata } from 'next'
import { getAdminSession } from '../../utils'
import UserStatsClient from './user-stats-client'

export const metadata: Metadata = {
  title: 'User Statistics | Sim Studio',
  description: 'View detailed statistics for a specific user',
}

export default async function UserStatsPage() {
  // Get session using the utility function
  await getAdminSession('/admin/dashboard/users')
  
  return <UserStatsClient />
}