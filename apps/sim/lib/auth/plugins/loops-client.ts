import type { BetterAuthClientPlugin } from 'better-auth/client'
import type { loops } from './loops'

export function loopsClient(options?: { subscription?: boolean }) {
  return {
    id: 'loops',
    $InferServerPlugin: {} as ReturnType<typeof loops>,
    getActions: ($fetch) => {
      return {
        // Create checkout session
        createCheckoutSession: async (
          data: {
            plan: string
            referenceId?: string
            seats?: number
          },
          fetchOptions?: any
        ) => {
          const res = await $fetch('/loops/checkout-session', {
            method: 'POST',
            body: data,
            ...fetchOptions,
          })
          return res
        },

        // List subscriptions
        listSubscriptions: async (fetchOptions?: any) => {
          const res = await $fetch('/loops/subscriptions', {
            method: 'GET',
            ...fetchOptions,
          })
          return res
        },

        // Create customer portal session
        createPortalSession: async (
          data?: {
            returnUrl?: string
          },
          fetchOptions?: any
        ) => {
          const res = await $fetch('/loops/portal-session', {
            method: 'POST',
            body: data || {},
            ...fetchOptions,
          })
          return res
        },

        // Subscription methods (mirroring Stripe plugin interface)
        subscription: options?.subscription
          ? {
              list: async (fetchOptions?: any) => {
                const res = await $fetch('/loops/subscriptions', {
                  method: 'GET',
                  ...fetchOptions,
                })
                return res
              },
              upgrade: async (
                data: {
                  plan: string
                  referenceId?: string
                  seats?: number
                },
                fetchOptions?: any
              ) => {
                const res = await $fetch('/loops/checkout-session', {
                  method: 'POST',
                  body: data,
                  ...fetchOptions,
                })
                return res
              },
              cancel: async (
                data: {
                  subscriptionId: string
                },
                fetchOptions?: any
              ) => {
                const res = await $fetch('/loops/subscription/cancel', {
                  method: 'POST',
                  body: data,
                  ...fetchOptions,
                })
                return res
              },
              portal: async (
                data?: {
                  returnUrl?: string
                },
                fetchOptions?: any
              ) => {
                const res = await $fetch('/loops/portal-session', {
                  method: 'POST',
                  body: data || {},
                  ...fetchOptions,
                })
                return res
              },
            }
          : undefined,
      }
    },
  } satisfies BetterAuthClientPlugin
}

