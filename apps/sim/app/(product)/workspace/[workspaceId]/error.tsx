'use client'

import { PageError } from '@/app/(product)/_components/shell-gate/shell-gate'

/** A failed workspace page, inside the workspace layout so its session and socket stay mounted. */
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <PageError reset={reset} />
}
