import { Metadata } from 'next'
import AdminDashboard from './dashboard/dashboard'

export const metadata: Metadata = {
  title: 'Admin | Sim Studio',
  description: 'Admin dashboard for Sim Studio',
}

export default function AdminPage() {
  return <AdminDashboard />
}
