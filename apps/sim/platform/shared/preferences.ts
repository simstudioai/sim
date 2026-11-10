'use client'

import { useSyncExternalStore } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { getBrowserTimezone } from '@/lib/core/utils/timezone'
import { toast } from '@/lib/toast/sink'
import { useUpdateUserProfile, useUserProfile } from '@/hooks/queries/user-profile'
import { useProfilePictureUpload } from '@/hooks/use-profile-picture-upload'
import { queryView } from '@/platform/shared/query-view'

const noSubscription = () => () => {}

/** Stable across the server and first client render, then the viewer's real zone. */
export function useBrowserTimezone(): string {
  return useSyncExternalStore(noSubscription, getBrowserTimezone, () => 'UTC')
}

/** The account's profile, read and written through the shared profile query. */
export function useProfileSettings() {
  const profile = useUserProfile()
  const updateProfile = useUpdateUserProfile()
  const upload = useProfilePictureUpload({
    currentImage: profile.data?.image ?? null,
    onUpload: (image) =>
      updateProfile.mutate(
        { image },
        { onError: (error) => toast.error(getErrorMessage(error, 'Could not save your picture')) }
      ),
    onError: (message) => toast.error(message),
  })
  return {
    ...queryView(profile),
    name: profile.data?.name ?? '',
    email: profile.data?.email ?? '',
    image: upload.previewUrl,
    uploading: upload.isUploading,
    onPictureChange: upload.handleFileChange,
    saveName: async (name: string) => {
      await updateProfile.mutateAsync({ name })
    },
  }
}
