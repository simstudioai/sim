import { Footer, Nav } from '@/app/(landing)/components'

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav hideAuthButtons={false} variant='landing' />
      <main className='relative'>{children}</main>
      <Footer fullWidth={true} />
    </>
  )
}
