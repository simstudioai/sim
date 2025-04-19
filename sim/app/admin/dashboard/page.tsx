import { Metadata } from 'next'
import PasswordAuth from '../password-auth'
import Dashboard from './dashboard'
import { ThemeProvider } from '@/app/w/components/providers/theme-provider'
import { getAdminSession } from './utils'

export const metadata: Metadata = {
  title: 'Admin Dashboard | Sim Studio',
  description: 'View analytics and manage your Sim Studio instance',
}

export default async function DashboardPage() {
  // Get session using the utility function
  await getAdminSession()
  
  return (
    <PasswordAuth>
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>
    </PasswordAuth>
  )
} 