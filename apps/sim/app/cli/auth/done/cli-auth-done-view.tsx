import { AuthHeader } from '@/app/(auth)/components'

/**
 * Where the CLI's listener sends the browser once it has the authorization
 * code. Static by design: the key is minted server-side during the CLI's
 * exchange and never passes through this page.
 */
export function CliAuthDoneView() {
  return (
    <AuthHeader
      title='Your terminal is connected'
      description='You can close this tab and return to your terminal.'
    />
  )
}
