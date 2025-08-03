import { FlickeringGrid } from '@/components/magicui/flickering-grid'
import { Button } from '@/components/ui'

function CTA() {
  return (
    <div className='relative z-10 flex w-full justify-center items-center py-16 sm:py-20 md:py-24 border-b border-border px-4 sm:px-8 '>
        <div className='absolute w-full h-full overflow-hidden'>
            <FlickeringGrid
                className="absolute z-0 [mask-image:radial-gradient(1000px_circle_at_center,white,transparent)]"
                squareSize={6}
                gridGap={6}
                color="#6F3DFA"
                maxOpacity={0.1}
                flickerChance={0.1}
            />
        </div>
        <div className='flex flex-col lg:flex-row gap-8 sm:gap-12 md:gap-16 lg:gap-24 xl:gap-80 items-center text-center lg:text-left z-10'>
            <p className='font-medium font-inter text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-foreground tracking-tighter leading-tight'>
                Build the future of AI
            </p>
            <div className='flex flex-col gap-3 sm:gap-4 w-full lg:w-auto'>
                <Button className='rounded-full px-6 sm:px-8 text-white text-lg sm:text-xl py-4 sm:py-6 font-normal bg-[#6F3DFA] w-full sm:w-auto'>
                    Start Building
                </Button>
                <Button variant="outline" className='rounded-full px-6 sm:px-8 shadow-sm text-lg sm:text-xl py-4 sm:py-6 font-normal w-full sm:w-auto'>
                    Read Docs
                </Button>
            </div>
        </div>
    </div>
  )
}

export default CTA
