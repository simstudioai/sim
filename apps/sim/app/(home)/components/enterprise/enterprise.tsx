/**
 * Enterprise section — compliance, scale, and security messaging.
 *
 * SEO:
 * - `<section id="enterprise" aria-labelledby="enterprise-heading">`.
 * - `<h2 id="enterprise-heading">` for the section title.
 * - Compliance certs (SOC 2, HIPAA) as visible `<strong>` text.
 * - Enterprise CTA links to contact form via `<a>` with `rel="noopener noreferrer"`.
 *
 * GEO:
 * - Entity-rich: "Sim is SOC 2 and HIPAA compliant" — not "We are compliant."
 * - `<ul>` checklist of features (SSO, RBAC, audit logs, SLA, on-premise deployment)
 *   as an atomic answer block for "What enterprise features does Sim offer?".
 */

import Image from 'next/image'
import Link from 'next/link'
import { Badge, ChevronDown } from '@/components/emcn'
import { Lock } from '@/components/emcn/icons'
import { GithubIcon } from '@/components/icons'
import { DemoRequestModal } from '@/app/(home)/components/demo-request/demo-request-modal'
import { AccessControlPanel } from '@/app/(home)/components/enterprise/components/access-control-panel'
import { AuditLogPreview } from '@/app/(home)/components/enterprise/components/audit-log-preview'

const MARQUEE_KEYFRAMES = `
  @keyframes marquee {
    0% { transform: translateX(0); }
    100% { transform: translateX(-25%); }
  }
  @media (prefers-reduced-motion: reduce) {
    @keyframes marquee { 0%, 100% { transform: none; } }
  }
`

const FEATURE_TAGS = [
  'Access Control',
  'Self-Hosting',
  'Bring Your Own Key',
  'Credential Sharing',
  'Custom Limits',
  'Admin API',
  'White Labeling',
  'Dedicated Support',
  '99.99% Uptime SLA',
  'Workflow Versioning',
  'On-Premise',
  'Organizations',
  'Workspace Export',
  'Audit Logs',
] as const

function TrustStrip() {
  return (
    <div className='mx-6 mt-4 grid grid-cols-1 overflow-hidden rounded-[8px] border border-[#2A2A2A] sm:grid-cols-3 md:mx-8'>
      {/* SOC 2 + HIPAA combined */}
      <Link
        href='https://app.vanta.com/sim.ai/trust/v35ia0jil4l7dteqjgaktn'
        target='_blank'
        rel='noopener noreferrer'
        className='group flex items-center gap-3 border-[#2A2A2A] border-b px-4 py-[14px] transition-colors hover:bg-[#212121] sm:border-r sm:border-b-0'
      >
        <Image
          src='/footer/soc2.png'
          alt='SOC 2 Type II'
          width={22}
          height={22}
          className='shrink-0 object-contain'
        />
        <div className='flex flex-col gap-[3px]'>
          <strong className='font-[430] font-season text-[13px] text-white leading-none'>
            SOC 2 & HIPAA
          </strong>
          <span className='font-[430] font-season text-[#F6F6F6]/30 text-[11px] leading-none tracking-[0.02em] transition-colors group-hover:text-[#F6F6F6]/55'>
            Type II · PHI protected →
          </span>
        </div>
      </Link>

      {/* Open Source -- center */}
      <Link
        href='https://github.com/simstudioai/sim'
        target='_blank'
        rel='noopener noreferrer'
        className='group flex items-center gap-3 border-[#2A2A2A] border-b px-4 py-[14px] transition-colors hover:bg-[#212121] sm:border-r sm:border-b-0'
      >
        <div className='flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#FFCC02]/10'>
          <GithubIcon width={11} height={11} className='text-[#FFCC02]/75' />
        </div>
        <div className='flex flex-col gap-[3px]'>
          <strong className='font-[430] font-season text-[13px] text-white leading-none'>
            Open Source
          </strong>
          <span className='font-[430] font-season text-[#F6F6F6]/30 text-[11px] leading-none tracking-[0.02em] transition-colors group-hover:text-[#F6F6F6]/55'>
            View on GitHub →
          </span>
        </div>
      </Link>

      {/* SSO */}
      <div className='flex items-center gap-3 px-4 py-[14px]'>
        <div className='flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#2ABBF8]/10'>
          <Lock className='h-[14px] w-[14px] text-[#2ABBF8]/75' />
        </div>
        <div className='flex flex-col gap-[3px]'>
          <strong className='font-[430] font-season text-[13px] text-white leading-none'>
            SSO & SCIM
          </strong>
          <span className='font-[430] font-season text-[#F6F6F6]/30 text-[11px] leading-none tracking-[0.02em]'>
            Okta, Azure AD, Google
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Enterprise() {
  return (
    <section id='enterprise' aria-labelledby='enterprise-heading' className='bg-[#F6F6F6]'>
      <div className='px-4 pt-[60px] pb-[40px] sm:px-8 sm:pt-[80px] sm:pb-0 md:px-[80px] md:pt-[100px]'>
        <div className='flex flex-col items-start gap-3 sm:gap-4 md:gap-[20px]'>
          <Badge
            variant='blue'
            size='md'
            dot
            className='bg-[#FFCC02]/10 font-season text-[#FFCC02] uppercase tracking-[0.02em]'
          >
            Enterprise
          </Badge>

          <h2
            id='enterprise-heading'
            className='max-w-[600px] font-[430] font-season text-[#1C1C1C] text-[32px] leading-[100%] tracking-[-0.02em] sm:text-[36px] md:text-[40px]'
          >
            Enterprise features for
            <br />
            fast, scalable workflows
          </h2>
        </div>

        <div className='mt-8 overflow-hidden rounded-[12px] bg-[#1C1C1C] sm:mt-10 md:mt-12'>
          <div className='grid grid-cols-1 border-[#2A2A2A] border-b lg:grid-cols-[1fr_420px]'>
            {/* Audit Trail */}
            <div className='border-[#2A2A2A] lg:border-r'>
              <div className='px-6 pt-6 md:px-8 md:pt-8'>
                <h3 className='font-[430] font-season text-[16px] text-white leading-[120%] tracking-[-0.01em]'>
                  Audit Trail
                </h3>
                <p className='mt-2 max-w-[480px] font-[430] font-season text-[#F6F6F6]/50 text-[14px] leading-[150%] tracking-[0.02em]'>
                  Every action is captured with full actor attribution.
                </p>
              </div>
              <AuditLogPreview />
              <div className='h-6 md:h-8' />
            </div>

            {/* Access Control */}
            <div className='border-[#2A2A2A] border-t lg:border-t-0'>
              <div className='px-6 pt-6 md:px-8 md:pt-8'>
                <h3 className='font-[430] font-season text-[16px] text-white leading-[120%] tracking-[-0.01em]'>
                  Access Control
                </h3>
                <p className='mt-[6px] font-[430] font-season text-[#F6F6F6]/50 text-[14px] leading-[150%] tracking-[0.02em]'>
                  Restrict providers, surfaces, and tools per group.
                </p>
              </div>
              <div className='mt-5 px-6 pb-6 md:mt-6 md:px-8 md:pb-8'>
                <AccessControlPanel />
              </div>
            </div>
          </div>

          <TrustStrip />

          {/* Scrolling feature ticker */}
          <div className='relative mt-6 overflow-hidden border-[#2A2A2A] border-t'>
            <style dangerouslySetInnerHTML={{ __html: MARQUEE_KEYFRAMES }} />
            {/* Fade edges */}
            <div
              aria-hidden='true'
              className='pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-24'
              style={{ background: 'linear-gradient(to right, #1C1C1C, transparent)' }}
            />
            <div
              aria-hidden='true'
              className='pointer-events-none absolute top-0 right-0 bottom-0 z-10 w-24'
              style={{ background: 'linear-gradient(to left, #1C1C1C, transparent)' }}
            />
            {/* Duplicate tags for seamless loop */}
            <div className='flex w-max' style={{ animation: 'marquee 30s linear infinite' }}>
              {[...FEATURE_TAGS, ...FEATURE_TAGS, ...FEATURE_TAGS, ...FEATURE_TAGS].map(
                (tag, i) => (
                  <span
                    key={i}
                    className='whitespace-nowrap border-[#2A2A2A] border-r px-5 py-4 font-[430] font-season text-[#F6F6F6]/40 text-[13px] leading-none tracking-[0.02em]'
                  >
                    {tag}
                  </span>
                )
              )}
            </div>
          </div>

          <div className='flex items-center justify-between border-[#2A2A2A] border-t px-6 py-5 md:px-8 md:py-6'>
            <p className='font-[430] font-season text-[#F6F6F6]/40 text-[15px] leading-[150%] tracking-[0.02em]'>
              Ready for growth?
            </p>
            <DemoRequestModal>
              <button
                type='button'
                className='group/cta inline-flex h-[32px] cursor-pointer items-center gap-[6px] rounded-[5px] border border-white bg-white px-[10px] font-[430] font-season text-[14px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
              >
                Book a demo
                <span className='relative h-[10px] w-[10px] shrink-0'>
                  <ChevronDown className='-rotate-90 absolute inset-0 h-[10px] w-[10px] transition-opacity duration-150 group-hover/cta:opacity-0' />
                  <svg
                    className='absolute inset-0 h-[10px] w-[10px] opacity-0 transition-opacity duration-150 group-hover/cta:opacity-100'
                    viewBox='0 0 10 10'
                    fill='none'
                  >
                    <path
                      d='M1 5H8M5.5 2L8.5 5L5.5 8'
                      stroke='currentColor'
                      strokeWidth='1.33'
                      strokeLinecap='square'
                      strokeLinejoin='miter'
                      fill='none'
                    />
                  </svg>
                </span>
              </button>
            </DemoRequestModal>
          </div>
        </div>
      </div>
    </section>
  )
}
