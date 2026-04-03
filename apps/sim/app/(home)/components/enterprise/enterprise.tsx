/**
 * Enterprise section — compliance, scale, and security messaging.
 *
 * SEO:
 * - `<section id="enterprise" aria-labelledby="enterprise-heading">`.
 * - `<h2 id="enterprise-heading">` for the section title.
 * - Compliance cert (SOC 2) as visible `<strong>` text.
 * - Enterprise CTA links to contact form via `<a>` with `rel="noopener noreferrer"`.
 *
 * GEO:
 * - Entity-rich: "Sim is SOC 2 compliant" — not "We are compliant."
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

const ENTERPRISE_FEATURE_MARQUEE_STYLES = `
  @keyframes enterprise-feature-marquee {
    0% { transform: translateX(0); }
    100% { transform: translateX(-25%); }
  }
  .enterprise-feature-marquee-track {
    animation: enterprise-feature-marquee 30s linear infinite;
  }
  .enterprise-feature-marquee:hover .enterprise-feature-marquee-track {
    animation-play-state: paused;
  }
  .enterprise-feature-marquee-tag {
    transition: background-color 0.3s ease, color 0.3s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .enterprise-feature-marquee-track {
      animation: none;
    }
    .enterprise-feature-marquee-tag {
      transition: none;
    }
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
    <div className='mx-6 mt-4 grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--landing-bg-elevated)] sm:grid-cols-3 md:mx-8'>
      {/* SOC 2 */}
      <Link
        href='https://app.vanta.com/sim.ai/trust/v35ia0jil4l7dteqjgaktn'
        target='_blank'
        rel='noopener noreferrer'
        className='group flex items-center gap-3 border-[var(--landing-bg-elevated)] border-b px-4 py-3.5 transition-colors hover:bg-[#212121] sm:border-r sm:border-b-0'
      >
        <Image
          src='/footer/soc2.png'
          alt='SOC 2 Type II'
          width={22}
          height={22}
          className='shrink-0 object-contain'
          unoptimized
        />
        <div className='flex flex-col gap-[3px]'>
          <strong className='font-[430] font-season text-small text-white leading-none'>
            SOC 2
          </strong>
          <span className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_55%,transparent)] text-xs leading-none tracking-[0.02em] transition-colors group-hover:text-[color-mix(in_srgb,var(--landing-text-subtle)_75%,transparent)]'>
            Type II →
          </span>
        </div>
      </Link>

      {/* Open Source -- center */}
      <Link
        href='https://github.com/simstudioai/sim'
        target='_blank'
        rel='noopener noreferrer'
        className='group flex items-center gap-3 border-[var(--landing-bg-elevated)] border-b px-4 py-3.5 transition-colors hover:bg-[#212121] sm:border-r sm:border-b-0'
      >
        <div className='flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#FFCC02]/10'>
          <GithubIcon width={11} height={11} className='text-[#FFCC02]/75' />
        </div>
        <div className='flex flex-col gap-[3px]'>
          <strong className='font-[430] font-season text-small text-white leading-none'>
            Open Source
          </strong>
          <span className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_55%,transparent)] text-xs leading-none tracking-[0.02em] transition-colors group-hover:text-[color-mix(in_srgb,var(--landing-text-subtle)_75%,transparent)]'>
            View on GitHub →
          </span>
        </div>
      </Link>

      {/* SSO */}
      <div className='flex items-center gap-3 px-4 py-3.5'>
        <div className='flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#2ABBF8]/10'>
          <Lock className='h-[14px] w-[14px] text-[#2ABBF8]/75' />
        </div>
        <div className='flex flex-col gap-[3px]'>
          <strong className='font-[430] font-season text-small text-white leading-none'>
            SSO & SCIM
          </strong>
          <span className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_55%,transparent)] text-xs leading-none tracking-[0.02em]'>
            Okta, Azure AD, Google
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Enterprise() {
  return (
    <section
      id='enterprise'
      aria-labelledby='enterprise-heading'
      className='bg-[var(--landing-bg-section)]'
    >
      <div className='px-4 pt-[60px] pb-10 sm:px-8 sm:pt-20 sm:pb-0 md:px-20 md:pt-[100px]'>
        <div className='flex flex-col items-start gap-3 sm:gap-4 md:gap-5'>
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
            className='max-w-[600px] text-balance font-[430] font-season text-[32px] text-[var(--landing-text-dark)] leading-[100%] tracking-[-0.02em] sm:text-[36px] md:text-[40px]'
          >
            Enterprise features for
            <br />
            fast, scalable workflows
          </h2>
        </div>

        <div className='mt-8 overflow-hidden rounded-[12px] bg-[var(--landing-bg)] sm:mt-10 md:mt-12'>
          <div className='grid grid-cols-1 border-[var(--landing-border)] border-b lg:grid-cols-[1fr_420px]'>
            {/* Audit Trail */}
            <div className='border-[var(--landing-border)] lg:border-r'>
              <div className='px-6 pt-6 md:px-8 md:pt-8'>
                <h3 className='font-[430] font-season text-[16px] text-white leading-[120%] tracking-[-0.01em]'>
                  Audit Trail
                </h3>
                <p className='mt-2 max-w-[480px] font-[430] font-season text-[#F6F6F6]/70 text-[14px] leading-[150%] tracking-[0.02em]'>
                  Every action is captured with full actor attribution.
                </p>
              </div>
              <AuditLogPreview />
              <div className='h-6 md:h-8' />
            </div>

            {/* Access Control */}
            <div className='border-[var(--landing-border)] border-t lg:border-t-0'>
              <div className='px-6 pt-6 md:px-8 md:pt-8'>
                <h3 className='font-[430] font-season text-[16px] text-white leading-[120%] tracking-[-0.01em]'>
                  Access Control
                </h3>
                <p className='mt-1.5 font-[430] font-season text-[#F6F6F6]/70 text-[14px] leading-[150%] tracking-[0.02em]'>
                  Restrict providers, surfaces, and tools per group.
                </p>
              </div>
              <div className='mt-5 px-6 pb-6 md:mt-6 md:px-8 md:pb-8'>
                <AccessControlPanel />
              </div>
            </div>
          </div>

          <TrustStrip />

          {/* Scrolling feature ticker — keyframe loop; pause on hover. Tags use transitions for hover. */}
          <div className='enterprise-feature-marquee relative mt-6 overflow-hidden border-[var(--landing-bg-elevated)] border-t'>
            <style dangerouslySetInnerHTML={{ __html: ENTERPRISE_FEATURE_MARQUEE_STYLES }} />
            {/* Fade edges */}
            <div
              aria-hidden='true'
              className='pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-24'
              style={{ background: 'linear-gradient(to right, var(--landing-bg), transparent)' }}
            />
            <div
              aria-hidden='true'
              className='pointer-events-none absolute top-0 right-0 bottom-0 z-10 w-24'
              style={{ background: 'linear-gradient(to left, var(--landing-bg), transparent)' }}
            />
            {/* Duplicate tags for seamless loop */}
            <div className='enterprise-feature-marquee-track flex w-max'>
              {[...FEATURE_TAGS, ...FEATURE_TAGS, ...FEATURE_TAGS, ...FEATURE_TAGS].map(
                (tag, i) => (
                  <span
                    key={i}
                    className='enterprise-feature-marquee-tag whitespace-nowrap border-[var(--landing-bg-elevated)] border-r px-5 py-4 font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-small leading-none tracking-[0.02em] hover:bg-white/[0.04] hover:text-[color-mix(in_srgb,var(--landing-text-subtle)_80%,transparent)]'
                  >
                    {tag}
                  </span>
                )
              )}
            </div>
          </div>

          <div className='flex items-center justify-between border-[var(--landing-bg-elevated)] border-t px-6 py-5 md:px-8 md:py-6'>
            <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-base leading-[150%] tracking-[0.02em]'>
              Ready for growth?
            </p>
            <DemoRequestModal>
              <button
                type='button'
                className='group/cta inline-flex h-[32px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-white bg-white px-2.5 font-[430] font-season text-[14px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
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
