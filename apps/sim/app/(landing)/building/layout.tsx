import { Footer, Nav } from '@/app/(landing)/components'

/**
 * Layout for the building/blog section with navigation and footer
 */
export default function BuildingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav hideAuthButtons={false} variant='landing' />
      <main className='relative'>{children}</main>
      <Footer fullWidth={true} />
    </>
  )
}
