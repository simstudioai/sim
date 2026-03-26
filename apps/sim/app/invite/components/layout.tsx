import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

interface InviteLayoutProps {
  children: React.ReactNode
}

export default function InviteLayout({ children }: InviteLayoutProps) {
  return (
    <div className='relative flex min-h-screen flex-col bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)]'>
      <header className='shrink-0'>
        <Navbar logoOnly />
      </header>
      <main className='flex flex-1 flex-col items-center justify-center px-4'>
        <div className='w-full max-w-lg px-4'>
          <div className='flex flex-col items-center justify-center'>{children}</div>
        </div>
      </main>
      <SupportFooter position='absolute' />
    </div>
  )
}
