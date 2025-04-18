import { Metadata } from 'next'
import PasswordAuth from '../password-auth'
import Dashboard from './dashboard'

export const metadata: Metadata = {
  title: 'Admin Dashboard | Sim Studio',
  description: 'View analytics and manage your Sim Studio instance',
}

export default function DashboardPage() {
  return (
    <PasswordAuth>
      <Dashboard />
    </PasswordAuth>
  )
} 