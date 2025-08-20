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
    { href: '/pricing', label: 'Pricing' },
    { href: '/enterprise', label: 'Enterprise' },
    // { href: '/blog', label: 'Blog' },
  ]

  const handleContributorsHover = usePrefetchOnHover()

  // Common CSS class for navigation items
  const navItemClass = `text-muted-foreground hover:text-foreground text-sm font-medium ${
    mobile ? 'p-2.5 text-sm text-left' : 'px-3 py-2'
  } rounded-lg transition-colors duration-200 block md:inline-block`

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
      <nav className='absolute top-0 right-0 left-0 z-30 px-6 py-4'>
        <div className='relative mx-auto flex max-w-7xl items-center justify-between'>
          <div className='flex-1'>
            <div className='h-[24px] w-[50px]' />
          </div>
          <div className='flex flex-1 justify-end'>
            <div className='h-[43px] w-[43px]' />
          </div>
        </div>
      </nav>
    )
  }

  return (
    <nav className='absolute top-0 right-0 left-0 z-30 scroll-smooth px-6 py-4'>
      <div className='relative mx-auto flex max-w-7xl items-center justify-between'>
        <div className='flex flex-1 items-center'>
          <div className='inline-block'>
            <Link href='/' className='inline-flex'>
              <Image
                src='/logo/primary/text/primary.svg'
                alt='Sim Logo'
                width={50}
                height={24}
                priority
                className='object-contain'
              />
            </Link>
          </div>
        </div>

        {!isMobile && (
          <div className='flex items-center gap-1'>
            <NavLinks currentPath={currentPath} onContactClick={onContactClick} />
          </div>
        )}

        <div className='flex flex-1 items-center justify-end'>
          <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
            {!isMobile && (
              <>
                <div className='flex items-center'>{children}</div>
                <div className='flex items-center gap-2'>
                  <Link href='/signup'>
                    <Button
                      variant='ghost'
                      className='rounded-full px-4 py-1.5 font-medium text-muted-foreground text-sm hover:bg-secondary hover:text-foreground'
                    >
                      Sign up <span className='ml-0.5'>→</span>
                    </Button>
                  </Link>
                  <Button
                    onClick={onContactClick}
                    className='rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm transition-colors duration-200 hover:bg-primary/90'
                  >
                    Schedule call <span className='ml-0.5'>→</span>
                  </Button>
                </div>
              </>
            )}

            {isMobile && (
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <button className='rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'>
                    <Menu className='h-5 w-5' />
                    <span className='sr-only'>Toggle menu</span>
                  </button>
                </SheetTrigger>
                <SheetContent
                  side='right'
                  className='flex h-full w-[280px] flex-col border-border border-l bg-background p-6 pt-6 text-foreground shadow-xl sm:w-[320px] [&>button]:hidden'
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <SheetHeader className='sr-only'>
                    <SheetTitle>Navigation Menu</SheetTitle>
                  </SheetHeader>
                  <div className='flex flex-grow flex-col gap-5'>
                    <NavLinks mobile currentPath={currentPath} onContactClick={onContactClick} />
                    {children && (
                      <div>
                        <SheetClose asChild>{children}</SheetClose>
                      </div>
                    )}
                    <div className='mt-auto pt-6'>
                      <div className='flex flex-col gap-2'>
                        <SheetClose asChild>
                          <Link href='/signup'>
                            <Button
                              variant='outline'
                              className='w-full rounded-full border-border bg-transparent py-2 font-medium text-muted-foreground text-sm hover:bg-secondary hover:text-foreground'
                            >
                              Sign up <span className='ml-0.5'>→</span>
                            </Button>
                          </Link>
                        </SheetClose>
                        <SheetClose asChild>
                          <Button
                            onClick={onContactClick}
                            className='w-full rounded-full bg-primary py-2 font-medium text-primary-foreground text-sm transition-colors duration-200 hover:bg-primary/90'
                          >
                            Schedule call <span className='ml-0.5'>→</span>
                          </Button>
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
