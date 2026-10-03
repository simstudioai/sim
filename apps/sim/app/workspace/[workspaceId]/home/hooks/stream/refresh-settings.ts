import type { QueryClient } from '@tanstack/react-query'
import type { SettingsRefresh } from '@/lib/mothership/generated/resources'
import { userProfileKeys } from '@/hooks/queries/current-user-data'
import { refreshGeneralSettings } from '@/hooks/queries/general-settings'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'

/** Read canonical settings again; replay must never restore a historical setting value. */
export function refreshSettings(queryClient: QueryClient, settings: SettingsRefresh): void {
  if (settings.scope === 'account' && settings.id === 'preferences') {
    void refreshGeneralSettings(queryClient)
    return
  }
  if (settings.scope === 'account' && settings.id === 'profile') {
    void queryClient.invalidateQueries({ queryKey: userProfileKeys.all })
    return
  }
  // Access, billing and integration policies affect resources beyond the Settings screen.
  // Keep live chat history stable while revalidating the rest of the current viewer's cache.
  void queryClient.invalidateQueries({
    predicate: (query) =>
      settings.id === 'recently-deleted' || query.queryKey[0] !== mothershipChatKeys.all[0],
  })
}
