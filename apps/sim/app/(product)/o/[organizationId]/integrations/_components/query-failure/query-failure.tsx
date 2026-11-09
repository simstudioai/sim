import { FailureNotice } from '@sim/emcn/status'

interface QueryFailureProps {
  message: string
  query: { isFetching: boolean; refetch: () => unknown }
}

export function QueryFailure({ message, query }: QueryFailureProps) {
  return (
    <FailureNotice
      message={message}
      retrying={query.isFetching}
      onRetry={() => void query.refetch()}
    />
  )
}
