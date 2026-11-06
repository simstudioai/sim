import { AuthLoader as Loader } from '@sim/auth-ui'
import { AuthHeader } from '@/app/(auth)/components'

export function OAuthConsentLoading() {
  return (
    <div role='status' className='au:space-y-[var(--auth-group-gap)]'>
      <AuthHeader title='Review app access' description='Loading the authorization request…' />
      <div className='au:flex au:justify-center'>
        <Loader aria-hidden='true' className='au:size-5' animate />
      </div>
    </div>
  )
}

export default function OAuthConsentRouteLoading() {
  return <OAuthConsentLoading />
}
