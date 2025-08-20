import { Button } from '@/components/ui'
import { FlickeringGrid } from '../../components/magicui/flickering-grid'

function CTA() {
  return (
    <div className='relative z-10 flex w-full items-center justify-center border-border border-b px-4 py-16 sm:px-8 sm:py-20 md:py-24 '>
      <div className='absolute h-full w-full overflow-hidden'>
        <FlickeringGrid
          className='absolute z-0 [mask-image:radial-gradient(1000px_circle_at_center,white,transparent)]'
          squareSize={6}
          gridGap={6}
          color='#6F3DFA'
          maxOpacity={0.1}
          flickerChance={0.1}
        />
      </div>
      <div className='z-10 flex flex-col items-center gap-8 text-center sm:gap-12 md:gap-16 lg:flex-row lg:gap-24 lg:text-left xl:gap-80'>
        <p className='font-inter font-medium text-4xl text-foreground leading-tight tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl'>
          Build the future of AI
        </p>
        <div className='flex w-full flex-col gap-3 sm:gap-4 lg:w-auto'>
          <Button className='w-full rounded-full bg-[#6F3DFA] px-6 py-4 font-normal text-lg text-white sm:w-auto sm:px-8 sm:py-6 sm:text-xl'>
            Start Building
          </Button>
          <Button
            variant='outline'
            className='w-full rounded-full px-6 py-4 font-normal text-lg shadow-sm sm:w-auto sm:px-8 sm:py-6 sm:text-xl'
          >
            Read Docs
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CTA
