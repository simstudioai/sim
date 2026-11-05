'use client'

import { PageError } from '@/platform/app/_components/shell-gate/shell-gate'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <PageError reset={reset} />
}
