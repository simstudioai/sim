import { hasSignedInDesktopExecutor } from '@/lib/desktop/executor/repository'

/**
 * Whether the user's turns can run on one of their desktops, so their workspace has background
 * desktop activity to show. Most users never install the app, and their pages never ask.
 */
export async function hasDesktopBackgroundExecutor(userId: string): Promise<boolean> {
  return hasSignedInDesktopExecutor(userId)
}
