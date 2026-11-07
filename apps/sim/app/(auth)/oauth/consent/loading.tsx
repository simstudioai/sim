import { AuthHeader } from '@sim/emcn-auth/heading'
import { AuthLoader as Loader } from '@sim/emcn-auth/loading'

export function OAuthConsentLoading() {
  return (
    <div role='status' className='au:flex au:flex-col au:gap-[var(--auth-group-gap)]'>
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
