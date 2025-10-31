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
                // TODO: Implement cancellation when Loops API supports it
                return { data: null, error: 'Cancellation not yet implemented' }
              },
              restore: async (
                data: {
                  subscriptionId: string
                },
                fetchOptions?: any
              ) => {
                // TODO: Implement restoration when Loops API supports it
                return { data: null, error: 'Restoration not yet implemented' }
              },
            }
          : undefined,
      }
    },
  } satisfies BetterAuthClientPlugin
}

