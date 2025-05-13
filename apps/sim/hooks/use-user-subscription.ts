import { useEffect, useState } from 'react'

interface UserSubscription {
  isPaid: boolean
  isLoading: boolean
  plan: string | null
  error: Error | null
  isEnterprise: boolean
}

export function useUserSubscription(): UserSubscription {
  const [subscription, setSubscription] = useState<UserSubscription>({
    isPaid: false,
    isLoading: true,
    plan: null,
    error: null,
    isEnterprise: false,
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
          isEnterprise: data.plan === 'enterprise' || false,
        })
      } catch (error) {
        setSubscription({
          isPaid: false,
          isLoading: false,
          plan: null,
          error: error instanceof Error ? error : new Error('Unknown error'),
          isEnterprise: false,
        })
      }
    }

    fetchSubscription()
  }, [])

  return subscription
}
