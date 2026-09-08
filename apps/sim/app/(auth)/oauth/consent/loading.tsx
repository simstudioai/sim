import { Loader } from '@sim/emcn'
import { AuthHeader } from '@/app/(auth)/components'

export function OAuthConsentLoading() {
  return (
    <div role='status' className='space-y-6'>
      <AuthHeader title='Review app access' description='Loading the authorization request…' />
      <div className='flex justify-center'>
        <Loader aria-hidden='true' className='size-5' animate />
      </div>
    </div>
  )
}

export default function OAuthConsentRouteLoading() {
  return <OAuthConsentLoading />
}
