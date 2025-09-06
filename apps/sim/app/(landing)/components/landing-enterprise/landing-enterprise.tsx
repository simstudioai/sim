import React from 'react'
import Image from 'next/image'

const enterpriseLogos = [
  {
    name: 'Department of Defense',
    logo: '/enterprise/dod.png',
    width: 70,
    height: 70,
  },
  {
    name: "Harry Ritchie's",
    logo: '/enterprise/hrj.png',
    width: 108,
    height: 54,
  },
  {
    name: 'Epiq Global',
    logo: '/enterprise/epiq.png',
    width: 96,
    height: 58,
  },
  {
    name: 'Mobile Health',
    logo: '/enterprise/mobilehealth.png',
    width: 90,
    height: 32,
  },
]

export default function LandingEnterprise() {
  return (
    <section
      id='enterprise'
      className='flex h-[182px] items-center pt-[34px]'
      aria-label='Enterprise customers'
    >
      <div className='relative flex h-full w-full items-center justify-between'>
        {enterpriseLogos.map((enterprise, index) => (
          <React.Fragment key={enterprise.name}>
            {/* Logo container - centered in its section */}
            <div className='flex flex-1 items-center justify-center'>
              <Image
                src={enterprise.logo}
                alt={enterprise.name}
                width={enterprise.width}
                height={enterprise.height}
                className='object-contain'
                unoptimized
              />
            </div>

            {/* Full height vertical separator line between logos */}
            {index < enterpriseLogos.length - 1 && (
              <div className='relative h-full'>
                <svg
                  width='2'
                  height='100%'
                  viewBox='0 0 2 200'
                  preserveAspectRatio='none'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  className='h-full'
                >
                  {/* Vertical line */}
                  <path d='M1 0V200' stroke='#E7E4EF' strokeWidth='2' />
                </svg>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </section>
  )
}
