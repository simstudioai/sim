import React from 'react'
import Image from 'next/image'

function Clients() {
  return (
    <div className="w-full flex flex-wrap gap-6 sm:gap-8 md:gap-12 lg:gap-16 xl:gap-20 items-center justify-center py-8 sm:py-12 md:py-16 lg:py-20 border-t border-b border-border px-4 sm:px-8 md:px-12 lg:px-20 xl:px-32">
      <Image 
        src='/clients/dod.svg' 
        alt='DoD' 
        width={120} 
        height={120} 
          className="h-12 sm:h-16 md:h-18 lg:h-20 w-auto"
      />
      <Image 
        src='/clients/harryritchies.png' 
        alt='Harry Ritchies' 
        width={120} 
        height={120} 
        className="h-12 sm:h-16 md:h-18 lg:h-20 w-auto"
      />
      <Image 
        src='/clients/epiq.png' 
        alt='Epiq' 
        width={120} 
        height={120} 
        className="h-12 sm:h-16 md:h-18 lg:h-20 w-auto"
      />
      <Image 
        src='/clients/mobilehealth.svg' 
        alt='Mobile Health' 
        width={120} 
        height={120} 
        className="h-12 sm:h-16 md:h-18 lg:h-20 w-auto"
      />
    </div>
  )
}

export default Clients
