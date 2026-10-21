import { FooterOverlapProbe } from '@/components/footer/footer-overlap'
import { SimWordmark } from '@/components/ui/sim-logo'
import { SIM_SITE_URL } from '@/lib/urls'

const FOOTER_LINKS = [
  { label: 'Status', href: 'https://status.sim.ai' },
  { label: 'GitHub', href: 'https://github.com/simstudioai/sim' },
  { label: 'Changelog', href: `${SIM_SITE_URL}/changelog` },
  { label: 'Get help', href: `${SIM_SITE_URL}/contact` },
  { label: 'Privacy', href: `${SIM_SITE_URL}/privacy` },
  { label: 'Terms', href: `${SIM_SITE_URL}/terms` },
] as const

/** Keeps the fixed sidebar above the footer when it enters the viewport. */
export function Footer() {
  return (
    <footer className='relative z-[22] mt-20 w-full border-[var(--border)] border-t bg-[var(--bg)] max-sm:mt-12'>
      <FooterOverlapProbe />
      <div className='mx-auto flex w-full max-w-[1460px] flex-wrap items-center justify-between gap-x-10 gap-y-4 px-8 py-8 max-sm:px-5'>
        <a href={SIM_SITE_URL} aria-label='Sim home' className='flex min-h-11 items-center'>
          <SimWordmark />
        </a>
        <nav aria-label='Footer navigation' className='flex flex-wrap gap-x-6 gap-y-1'>
          {FOOTER_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className='flex min-h-11 items-center text-[var(--text-secondary)] text-sm hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4'
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
