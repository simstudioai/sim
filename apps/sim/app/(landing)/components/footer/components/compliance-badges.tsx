import Image from 'next/image'
import Link from 'next/link'
import { HIPAABadgeIcon } from '@/components/icons'

export default function ComplianceBadges() {
  return (
    <div className='mt-[6px] flex items-center gap-[12px]'>
      {/* SOC2 badge */}
      <Link href='https://trust.delve.co/sim-studio' target='_blank' rel='noopener noreferrer'>
        <Image
          src='/footer/soc2.png'
          alt='SOC2 Compliant'
          width={54}
          height={54}
          className='object-contain'
          loading='lazy'
          quality={75}
        />
      </Link>
      {/* HIPAA badge */}
      <Link href='https://trust.delve.co/sim-studio' target='_blank' rel='noopener noreferrer'>
        <HIPAABadgeIcon className='h-[54px] w-[54px]' />
      </Link>
    </div>
  )
}
