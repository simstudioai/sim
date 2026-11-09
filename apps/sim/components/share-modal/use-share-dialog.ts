'use client'

import type { ShareRecord } from '@/lib/api/contracts/public-shares'

export interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  fileId: string
  fileName: string
  /** Share state already known from the file row, used as the initial value to avoid flicker. */
  initialShare?: ShareRecord | null
}
