import { useEffect, useState } from 'react'

interface UserSubscription {
  isPaid: boolean
  isLoading: boolean
  plan: string | null
  error: Error | null
}

export function useUserSubscription(): UserSubscription {
  const [subscription, setSubscription] = useState<UserSubscription>({
    isPaid: false,
    isLoading: true,
    plan: null,
    error: null,
  })

  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const response = await fetch('/api/user/subscription')

        if (!response.ok) {
          throw new Error('Failed to fetch subscription data')
        }

        const data = await response.json()

        setSubscription({
          isPaid: data.isPaid,
          isLoading: false,
          plan: data.plan,
          error: null,
        })
      } catch (error) {
        setSubscription({
          isPaid: false, // Default to free plan if we can't verify
          isLoading: false,
          plan: null,
          error: error instanceof Error ? error : new Error('Unknown error'),
        })
      }
    }

    fetchSubscription()
  }, [])

  return subscription
}
