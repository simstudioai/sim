'use client'

import { PageError } from '@/app/(product)/_components/shell-gate/shell-gate'

/** A failed workspace page, inside the workspace layout so its session and socket stay mounted. */
export default function WorkspaceError({ retry }: { retry: () => void }) {
  return <PageError retry={retry} />
}
