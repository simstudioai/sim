'use client'

import { ChipLink } from '@sim/emcn'

/** Leave the app router when navigating to the independently served homepage. */
export function ReturnHomeLink() {
  return (
    <ChipLink
      variant='primary'
      href='/'
      prefetch={false}
      onNavigate={(event) => {
        event.preventDefault()
        window.location.assign('/')
      }}
    >
      Return home
    </ChipLink>
  )
}
