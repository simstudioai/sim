'use client'

import type { ReactNode } from 'react'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'

/** The fields of a React Query result a settings read renders from. */
interface SettingsReadQuery<T> {
  data: T | undefined
  error: unknown
  isLoadingError: boolean
  isRefetchError: boolean
  isFetching: boolean
  refetch: () => unknown
}

interface SettingsReadProps<T> {
  query: SettingsReadQuery<T>
  /** The failure notice's message when the error carries none: `Failed to load identity providers`. */
  failureMessage: string
  children: (data: T) => ReactNode
}

/**
 * A settings read's three states. Pending paints nothing; a first read that fails is a
 * `FailureNotice` with Retry; data renders `children`, under a `FailureNotice` when a later refresh
 * failed, since the content on screen stays worth reading. Empty is the children's to say.
 */
export function SettingsRead<T>({ query, failureMessage, children }: SettingsReadProps<T>) {
  const failure = (
    <FailureNotice
      message={getErrorMessage(query.error, failureMessage)}
      retrying={query.isFetching}
      onRetry={() => void query.refetch()}
    />
  )
  if (query.data === undefined) return query.isLoadingError ? failure : null
  return (
    <>
      {query.isRefetchError && failure}
      {children(query.data)}
    </>
  )
}
