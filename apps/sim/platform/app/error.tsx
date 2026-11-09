'use client'

import { PageError } from '@/app/(product)/_components/shell-gate/shell-gate'

/** Catches what the shell's own boundary cannot: a failure in the shell layout itself. */
export default function RootError({ reset }: { reset: () => void }) {
  return <PageError fullPage reset={reset} />
}
