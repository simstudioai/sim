'use client'

import { ChipLink } from '@sim/emcn'

/** A document navigation initializes the landing theme when leaving an app status page. */
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
