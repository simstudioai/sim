'use client'

import { useFixtureSettingsActions } from '@/platform/lib/data/settings-providers'
import {
  useWhitelabelForm as useSharedWhitelabelForm,
  type WhitelabelSettings,
} from '@/platform/shared/whitelabeling'

/** Fixtures keep an uploaded logo in the session rather than storing it. */
export function useWhitelabelForm(
  organizationId: string,
  initial: WhitelabelSettings,
  uploadWorkspaceId: string | undefined
) {
  const fixture = useFixtureSettingsActions()
  return useSharedWhitelabelForm(
    organizationId,
    initial,
    uploadWorkspaceId,
    fixture?.uploadBrandImage
  )
}
