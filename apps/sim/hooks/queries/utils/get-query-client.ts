import { isServer, type QueryClient } from '@tanstack/react-query'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'

let browserQueryClient: QueryClient | undefined

/**
 * Returns a QueryClient instance. On the server, creates a new instance per request.
 * On the client, reuses a singleton instance.
 */
export function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}
