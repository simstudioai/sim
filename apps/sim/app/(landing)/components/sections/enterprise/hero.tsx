import Image from 'next/image'
import { Button } from '@/components/ui/button'

function Hero() {
  return (
    <div className='relative flex min-h-screen w-full flex-col items-center overflow-hidden px-4 py-48 sm:px-8 md:px-12 lg:px-20 lg:py-64 xl:px-32'>
      <Image
        src='/static/enterprise_bg.png'
        className='absolute top-0 left-0 h-full w-full object-cover'
        alt='Sim'
        draggable={false}
        width={3000}
        height={3000}
      />
      <div className='z-10 flex w-full flex-col items-center gap-12 lg:gap-16'>
        <div className='flex flex-col items-center gap-8 text-center'>
          <h1 className='font-inter font-medium text-5xl text-foreground leading-tight tracking-[-0.04em] lg:text-6xl'>
            Create AI Agents in seconds,{' '}
            <span className='bg-gradient-to-b from-[#6F3DFA] via-[#F05391] to-[#9664EB] bg-clip-text text-transparent'>
              not weeks.
            </span>
          </h1>
          <p className='max-w-2xl text-[#484848] text-base leading-6 sm:text-lg md:text-xl'>
            Sim is the AI workflow platform where teams move fast without stressing IT. Speed,
            security, and control, all in one.
          </p>
        </div>
        <Button className='bg-[#6F3DFA]'>Contact Sales</Button>
        <div className='relative w-full'>
          <div className='relative z-0 flex aspect-video w-full rounded-[10px] border border-border bg-background/80 p-2 shadow-sm'>
            <div className='flex h-full w-full flex-col justify-end rounded-[6px] bg-background'>
              {/* ADD CONTENT HERE */}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Hero
