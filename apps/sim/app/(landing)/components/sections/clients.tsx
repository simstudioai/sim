import Image from 'next/image'

function Clients() {
  return (
    <div className='flex w-full flex-wrap items-center justify-center gap-6 border-border border-t border-b px-4 py-8 sm:gap-8 sm:px-8 sm:py-12 md:gap-12 md:px-12 md:py-16 lg:gap-16 lg:px-20 lg:py-20 xl:gap-20 xl:px-32'>
      <Image
        src='/clients/dod.svg'
        alt='DoD'
        width={120}
        height={120}
        className='h-12 w-auto sm:h-16 md:h-18 lg:h-20'
      />
      <Image
        src='/clients/harryritchies.png'
        alt='Harry Ritchies'
        width={120}
        height={120}
        className='h-12 w-auto sm:h-16 md:h-18 lg:h-20'
      />
      <Image
        src='/clients/epiq.png'
        alt='Epiq'
        width={120}
        height={120}
        className='h-12 w-auto sm:h-16 md:h-18 lg:h-20'
      />
      <Image
        src='/clients/mobilehealth.svg'
        alt='Mobile Health'
        width={120}
        height={120}
        className='h-12 w-auto sm:h-16 md:h-18 lg:h-20'
      />
    </div>
  )
}

export default Clients
