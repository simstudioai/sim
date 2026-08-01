import { AuthHeader } from '@/app/(auth)/components'

/**
 * Where the CLI's listener sends the browser once it has the authorization
 * code. Static by design: the key is minted server-side during the CLI's
 * exchange and never passes through this page.
 */
export function CliAuthDoneView() {
  return (
    <AuthHeader
      title='Approved'
      description='Your terminal is finishing up — you can close this tab.'
    />
  )
}
