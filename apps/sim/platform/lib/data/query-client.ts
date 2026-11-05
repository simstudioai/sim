import { isServer, type QueryClient } from '@tanstack/react-query'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'

let browserQueryClient: QueryClient | undefined

/** One client for the life of the document in the browser, one per request on the server. */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient()
  browserQueryClient ??= makeQueryClient()
  return browserQueryClient
}
