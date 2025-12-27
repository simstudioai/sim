import Nav from '@/app/(landing)/components/nav/nav'

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='relative min-h-screen text-foreground'>
      <div className='-z-50 pointer-events-none fixed inset-0 bg-white' />
      <Nav />
      {children}
    </div>
  )
}
