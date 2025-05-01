import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

/**
 * Get the analytics session and redirect if not authenticated
 * This function should be used in server components to handle authentication
 * @param callbackUrl - The URL to redirect to after login
 * @returns The session object if authenticated
 */
export async function getAnalyticsSession(callbackUrl: string = '/admin/analytics') {
  const session = await getSession()
  
  if (!session?.user?.email) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }
  
  return session
} 