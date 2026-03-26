import Image from 'next/image'
import Link from 'next/link'
import { HIPAABadgeIcon } from '@/components/icons'

export default function ComplianceBadges() {
  return (
    <div className='mt-1.5 flex items-center gap-3'>
      {/* SOC2 badge */}
      <Link
        href='https://app.vanta.com/sim.ai/trust/v35ia0jil4l7dteqjgaktn'
        target='_blank'
        rel='noopener noreferrer'
      >
        <Image
          src='/footer/soc2.png'
          alt='SOC2 Compliant'
          width={54}
          height={54}
          className='object-contain'
          loading='lazy'
          unoptimized
        />
      </Link>
      {/* HIPAA badge */}
      <Link
        href='https://app.vanta.com/sim.ai/trust/v35ia0jil4l7dteqjgaktn'
        target='_blank'
        rel='noopener noreferrer'
      >
        <HIPAABadgeIcon className='h-[54px] w-[54px]' />
      </Link>
    </div>
  )
}
