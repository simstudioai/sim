import { Metadata } from 'next'
import PasswordAuth from '../password-auth'
import Dashboard from './components/dashboard/dashboard'
import { ThemeProvider } from '@/app/w/components/providers/theme-provider'

export const metadata: Metadata = {
  title: 'Admin Dashboard | Sim Studio',
  description: 'View analytics and manage your Sim Studio instance',
}

export default function DashboardPage() {
  return (
    <PasswordAuth>
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>
    </PasswordAuth>
  )
} 