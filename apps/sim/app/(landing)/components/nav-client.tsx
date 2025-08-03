'use client'

import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { usePrefetchOnHover } from '@/app/(landing)/utils/prefetch'

// Component for Navigation Links
const NavLinks = ({
  mobile,
  currentPath,
  onContactClick,
}: {
  mobile?: boolean
  currentPath?: string
  onContactClick?: () => void
}) => {
  const navigationLinks = [
    { href: 'https://docs.sim.ai/', label: 'Docs', external: true },
    { href: '#pricing', label: 'Pricing' },
    { href: '/enterprise', label: 'Enterprise' },
    // { href: '/blog', label: 'Blog' },
  ]

  const handleContributorsHover = usePrefetchOnHover()

  // Common CSS class for navigation items
  const navItemClass = `text-black/60 hover:text-black/100 text-base font-geist-sans ${
    mobile ? 'p-2.5 text-lg font-medium text-left' : 'p-1.5'
  } rounded-md transition-colors duration-200 block md:inline-block`

  return (
    <>
      {navigationLinks.map((link) => {
        const linkElement = (
          <div key={link.label}>
            <Link
              href={link.href}
              className={navItemClass}
              onMouseEnter={link.label === 'Contributors' ? handleContributorsHover : undefined}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {link.label}
            </Link>
          </div>
        )

        // Wrap the div with SheetClose if mobile
        return mobile ? (
          <SheetClose asChild key={link.label}>
            {linkElement}
          </SheetClose>
        ) : (
          linkElement
        )
      })}

      {/* Enterprise button with the same action as contact */}
      {onContactClick &&
        (mobile ? (
          <SheetClose asChild key='enterprise'>
            <div>
              <Link
                href='https://form.typeform.com/to/jqCO12pF'
                target='_blank'
                rel='noopener noreferrer'
                className={navItemClass}
              >
                Enterprise
              </Link>
            </div>
          </SheetClose>
        ) : (
          <div key='enterprise'>
            <Link
              href='https://form.typeform.com/to/jqCO12pF'
              target='_blank'
              rel='noopener noreferrer'
              className={navItemClass}
            >
              Enterprise
            </Link>
          </div>
        ))}
    </>
  )
}

interface NavClientProps {
  children: React.ReactNode
  initialIsMobile?: boolean
  currentPath?: string
  onContactClick?: () => void
}

export default function NavClient({
  children,
  initialIsMobile,
  currentPath,
  onContactClick,
}: NavClientProps) {
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(initialIsMobile ?? false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const _router = useRouter()

  useEffect(() => {
    setMounted(true)
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()

    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Handle initial loading state - don't render anything that could cause layout shift
  // until we've measured the viewport
  if (!mounted) {
    return (
      <nav className='absolute top-1 right-0 left-0 z-30 px-4 py-8'>
        <div className='relative mx-auto flex max-w-7xl items-center justify-between'>
          <div className='flex-1'>
            <div className='h-[32px] w-[32px]' />
          </div>
          <div className='flex flex-1 justify-end'>
            <div className='h-[43px] w-[43px]' />
          </div>
        </div>
      </nav>
    )
  }

  return (
    <nav className='absolute top-1 right-0 left-0 z-30 px-4 py-8 scroll-smooth'>
      <div className='relative mx-auto flex max-w-7xl items-center justify-between'>
        <div className='flex flex-1 items-center'>
          <div className='inline-block'>
            <Link href='/' className='inline-flex'>
              <Image src='/sim.svg' alt='Sim Logo' width={42} height={42} />
            </Link>
          </div>
        </div>

        {!isMobile && (
          <div className='flex items-center gap-4 px-2 py-1'>
            <NavLinks currentPath={currentPath} onContactClick={onContactClick} />
          </div>
        )}

        <div className='flex flex-1 items-center justify-end'>
          <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
            {!isMobile && (
              <>
                <div className='flex items-center'>{children}</div>
                <div className='flex items-center gap-3'>
                  <Link href='/login'>
                    <Button variant='ghost' className='rounded-[8px] font-geist-sans font-medium text-base text-neutral-900 hover:bg-neutral-200/50'>
                      Login
                    </Button>
                  </Link>
                  <Link href='/signup'>
                    <Button className='rounded-[8px] bg-[#6F3DFA] font-geist-sans font-medium text-base text-neutral-100 transition-colors duration-200 hover:bg-[#802FFF]'>
                      Sign up
                    </Button>
                  </Link>
                </div>
              </>
            )}

            {isMobile && (
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <button className='rounded-md p-2 text-neutral-900 hover:bg-neutral-200/50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'>
                    <Menu className='h-6 w-6' />
                    <span className='sr-only'>Toggle menu</span>
                  </button>
                </SheetTrigger>
                <SheetContent
                  side='right'
                  className='flex h-full w-[280px] flex-col border-[#181818] border-l bg-neutral-100 p-6 pt-6 text-neutral-900 shadow-xl sm:w-[320px] [&>button]:hidden'
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <SheetHeader className='sr-only'>
                    <SheetTitle>Navigation Menu</SheetTitle>
                  </SheetHeader>
                  <div className='flex flex-grow flex-col gap-5'>
                    <NavLinks
                      mobile
                      currentPath={currentPath}
                      onContactClick={onContactClick}
                    />
                    {children && (
                      <div>
                        <SheetClose asChild>{children}</SheetClose>
                      </div>
                    )}
                    <div className='mt-auto pt-6'>
                      <div className='flex flex-col gap-3'>
                        <SheetClose asChild>
                          <Link href='/login'>
                            <Button variant='outline' className='w-full py-6 font-medium text-base text-neutral-900 bg-transparent hover:bg-neutral-200/50'>
                              Login
                            </Button>
                          </Link>
                        </SheetClose>
                        <SheetClose asChild>
                          <Link href='/signup'>
                            <Button className='w-full bg-[#701ffc] py-6 font-medium text-base text-white shadow-[#701ffc]/20 shadow-lg transition-colors duration-200 hover:bg-[#802FFF]'>
                              Sign up
                            </Button>
                          </Link>
                        </SheetClose>
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
