import Image from 'next/image'
import { Badge } from '@/components/emcn'

export default function Features() {
  return (
    <section
      id='features'
      aria-labelledby='features-heading'
      className='relative overflow-hidden bg-[#F6F6F6] pb-[144px]'
    >
      <div aria-hidden='true' className='absolute top-0 left-0 w-full'>
        <Image
          src='/landing/features-transition.svg'
          alt=''
          width={1440}
          height={366}
          className='h-auto w-full'
          priority
        />
      </div>

      <div className='relative z-10 px-[80px] pt-[100px]'>
        <div className='flex flex-col items-start gap-[20px]'>
          <Badge
            variant='blue'
            size='md'
            dot
            className='bg-[#FA4EDF]/10 font-season text-[#FA4EDF] uppercase tracking-[0.02em]'
          >
            Integrations
          </Badge>
          <h2
            id='features-heading'
            className='font-[430] font-season text-[#1C1C1C] text-[40px] leading-[100%] tracking-[-0.02em]'
          >
            Everything you need
          </h2>
        </div>
      </div>
    </section>
  )
}
