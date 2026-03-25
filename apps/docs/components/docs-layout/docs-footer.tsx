import Link from 'next/link'
import { SimLogoFull } from '@/components/ui/sim-logo'

const FOOTER_LINKS = [
  { label: 'Join Discord', href: 'https://discord.gg/Hr4UWYEcTT' },
  { label: 'Status', href: 'https://status.sim.ai' },
  { label: 'Privacy Policy', href: 'https://sim.ai/privacy' },
] as const

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='currentColor' aria-label='X' {...props}>
      <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
    </svg>
  )
}

function GitHubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='currentColor' aria-label='GitHub' {...props}>
      <path d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' />
    </svg>
  )
}

function LinkedInIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='currentColor' aria-label='LinkedIn' {...props}>
      <path d='M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' />
    </svg>
  )
}

const SOCIAL_LINKS = [
  { label: 'X', href: 'https://x.com/simdotai', icon: XIcon },
  { label: 'GitHub', href: 'https://github.com/simstudioai/sim', icon: GitHubIcon },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/simstudioai/', icon: LinkedInIcon },
] as const

export function DocsFooter() {
  return (
    <footer
      data-docs-footer
      className='mt-auto border-neutral-200/60 border-t dark:border-neutral-700/30'
    >
      <div className='mx-auto flex w-full max-w-[90rem] items-center justify-between px-8 py-6'>
        <div className='flex items-center gap-2.5'>
          <SimLogoFull className='h-4 w-auto' />
        </div>
        <nav className='hidden items-center gap-6 sm:flex'>
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              target='_blank'
              rel='noopener noreferrer'
              className='font-[420] text-[13.5px] text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300'
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right: Social icons */}
        <div className='flex items-center gap-3'>
          {SOCIAL_LINKS.map((social) => (
            <Link
              key={social.label}
              href={social.href}
              target='_blank'
              rel='noopener noreferrer'
              className='text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
              aria-label={social.label}
            >
              <social.icon className='h-[18px] w-[18px]' />
            </Link>
          ))}
        </div>
      </div>
    </footer>
  )
}
