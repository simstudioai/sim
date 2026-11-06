'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { generateId } from '@sim/utils/id'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { OrganizationSummaryRequest } from '@/lib/organizations/search-params'

export type SummaryRequest = OrganizationSummaryRequest

/** Summaries Search asked for that the conversation has not sent yet, oldest first. */
export function useSummaryQueue() {
  const [summaries, setSummaries] = useState<SummaryRequest[]>([])
  const consume = useCallback(
    (id: string) => setSummaries((current) => current.filter((request) => request.id !== id)),
    []
  )
  return {
    pending: summaries.at(0),
    enqueue: (message: string, assistantSearch: WorkspaceSearchFilters) =>
      setSummaries((current) => [...current, { id: generateId(), message, assistantSearch }]),
    consume,
    clear: () => setSummaries([]),
  }
}

interface SendSummaryOptions {
  request: SummaryRequest | undefined
  onConsumed?: (id: string) => void
  send: (request: SummaryRequest) => void
}

/** Sends each request once, however often the conversation re-renders while it leaves the queue. */
export function useSendSummary({ request, onConsumed, send }: SendSummaryOptions) {
  const sent = useRef<string | null>(null)
  useEffect(() => {
    if (!request || sent.current === request.id) return
    sent.current = request.id
    onConsumed?.(request.id)
    send(request)
  }, [request, onConsumed, send])
}
