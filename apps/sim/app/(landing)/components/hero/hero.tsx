import { ArrowUpCircle } from 'lucide-react'
import Background from '@/app/(landing)/components/hero/components/background'
import Nav from '@/app/(landing)/components/nav/nav'
import { soehne } from '@/app/fonts/soehne/soehne'

export default function Hero() {
  return (
    <Background>
      <Nav />
      <div className='flex w-full flex-col items-center justify-center gap-[2px] pt-[88px]'>
        <h1 className={`${soehne.className} font-medium text-[74px] tracking-tight`}>
          Workflows for LLMs
        </h1>
        <h2 className={`${soehne.className} text-center font-normal text-[22px] opacity-70`}>
          Build and deploy AI agent workflows.
        </h2>
        <div className='flex items-center justify-center pt-8'>
          <textarea className='w-[400px] rounded-lg border border-gray-200 pt-4' />
          <ArrowUpCircle />
        </div>
      </div>
    </Background>
  )
}
