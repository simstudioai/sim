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
'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { Badge, ChevronDown } from '@/components/emcn'
import { Lock } from '@/components/emcn/icons'
import { GithubIcon } from '@/components/icons'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

/** Consistent color per actor — same pattern as Collaboration section cursors. */
const ACTOR_COLORS: Record<string, string> = {
  'Sarah K.': '#2ABBF8',
  'Sid G.': '#33C482',
  'Theo L.': '#FA4EDF',
  'Abhay K.': '#FFCC02',
  'Danny S.': '#FF6B35',
}

/** Left accent bar opacity by recency — newest is brightest. */
const ACCENT_OPACITIES = [0.75, 0.5, 0.35, 0.22, 0.12, 0.05] as const

interface LogEntry {
  id: number
  actor: string
  /** Matches the `description` field stored by recordAudit() */
  description: string
  resourceType: string
  /** Unix ms timestamp of when this entry was "received" */
  insertedAt: number
}

function formatTimeAgo(insertedAt: number): string {
  const elapsed = Date.now() - insertedAt
  if (elapsed < 8_000) return 'just now'
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s ago`
  return `${Math.floor(elapsed / 60_000)}m ago`
}

/**
 * Entry templates using real description strings from the actual recordAudit()
 * calls across the codebase (e.g. `Added BYOK key for openai`,
 * `Invited alex@acme.com to workspace as member`).
 */
const ENTRY_TEMPLATES: Omit<LogEntry, 'id' | 'insertedAt'>[] = [
  { actor: 'Sarah K.', description: 'Deployed workflow "Email Triage"', resourceType: 'workflow' },
  {
    actor: 'Sid G.',
    description: 'Invited alex@acme.com to workspace as member',
    resourceType: 'member',
  },
  { actor: 'Theo L.', description: 'Added BYOK key for openai', resourceType: 'byok_key' },
  { actor: 'Sarah K.', description: 'Created workflow "Invoice Parser"', resourceType: 'workflow' },
  {
    actor: 'Abhay K.',
    description: 'Created permission group "Engineering"',
    resourceType: 'permission_group',
  },
  { actor: 'Danny S.', description: 'Created API key "Production Key"', resourceType: 'api_key' },
  {
    actor: 'Theo L.',
    description: 'Changed permissions for sam@acme.com to editor',
    resourceType: 'member',
  },
  { actor: 'Sarah K.', description: 'Uploaded file "Q3_Report.pdf"', resourceType: 'file' },
  {
    actor: 'Sid G.',
    description: 'Created credential set "Prod Keys"',
    resourceType: 'credential_set',
  },
  {
    actor: 'Abhay K.',
    description: 'Created knowledge base "Internal Docs"',
    resourceType: 'knowledge_base',
  },
  { actor: 'Danny S.', description: 'Updated environment variables', resourceType: 'environment' },
  {
    actor: 'Sarah K.',
    description: 'Added tool "search_web" to MCP server',
    resourceType: 'mcp_server',
  },
  { actor: 'Sid G.', description: 'Created webhook "Stripe Payment"', resourceType: 'webhook' },
  { actor: 'Theo L.', description: 'Deployed chat "Support Assistant"', resourceType: 'chat' },
  { actor: 'Abhay K.', description: 'Created table "Lead Tracker"', resourceType: 'table' },
  { actor: 'Danny S.', description: 'Revoked API key "Staging Key"', resourceType: 'api_key' },
  {
    actor: 'Sarah K.',
    description: 'Duplicated workflow "Data Enrichment"',
    resourceType: 'workflow',
  },
  {
    actor: 'Sid G.',
    description: 'Removed member theo@acme.com from workspace',
    resourceType: 'member',
  },
  {
    actor: 'Theo L.',
    description: 'Updated knowledge base "Product Docs"',
    resourceType: 'knowledge_base',
  },
  { actor: 'Abhay K.', description: 'Created folder "Finance Workflows"', resourceType: 'folder' },
  {
    actor: 'Danny S.',
    description: 'Uploaded document "onboarding-guide.pdf"',
    resourceType: 'document',
  },
  {
    actor: 'Sarah K.',
    description: 'Updated credential set "Prod Keys"',
    resourceType: 'credential_set',
  },
  {
    actor: 'Sid G.',
    description: 'Added member abhay@acme.com to permission group "Engineering"',
    resourceType: 'permission_group',
  },
  { actor: 'Theo L.', description: 'Locked workflow "Customer Sync"', resourceType: 'workflow' },
]

const INITIAL_OFFSETS_MS = [0, 20_000, 75_000, 180_000, 360_000, 600_000]

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

interface AuditRowProps {
  entry: LogEntry
  index: number
}

function AuditRow({ entry, index }: AuditRowProps) {
  const color = ACTOR_COLORS[entry.actor] ?? '#F6F6F6'
  const accentOpacity = ACCENT_OPACITIES[index] ?? 0.04
  const timeAgo = formatTimeAgo(entry.insertedAt)

  return (
    <div className='group relative overflow-hidden border-[#2A2A2A] border-b bg-[#1C1C1C] transition-colors duration-150 last:border-b-0 hover:bg-[#212121]'>
      {/* Left accent bar — brightness encodes recency */}
      <div
        aria-hidden='true'
        className='absolute top-0 bottom-0 left-0 w-[2px] transition-opacity duration-150 group-hover:opacity-100'
        style={{ backgroundColor: color, opacity: accentOpacity }}
      />

      {/* Row content */}
      <div className='flex min-w-0 items-center gap-3 py-[10px] pr-4 pl-5'>
        {/* Actor avatar */}
        <div
          className='flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full'
          style={{ backgroundColor: `${color}20` }}
        >
          <span className='font-[500] font-season text-[9px] leading-none' style={{ color }}>
            {entry.actor[0]}
          </span>
        </div>

        {/* Time */}
        <span className='w-[56px] shrink-0 font-[430] font-season text-[#F6F6F6]/30 text-[11px] leading-none tracking-[0.02em]'>
          {timeAgo}
        </span>

        <span className='min-w-0 truncate font-[430] font-season text-[12px] leading-none tracking-[0.02em]'>
          <span className='text-[#F6F6F6]/80'>{entry.actor}</span>
          <span className='hidden sm:inline'>
            <span className='text-[#F6F6F6]/40'> · </span>
            <span className='text-[#F6F6F6]/55'>{entry.description}</span>
          </span>
        </span>
      </div>
    </div>
  )
}

function AuditLogPreview() {
  const counterRef = useRef(ENTRY_TEMPLATES.length)
  const templateIndexRef = useRef(6 % ENTRY_TEMPLATES.length)

  const now = Date.now()
  const [entries, setEntries] = useState<LogEntry[]>(() =>
    ENTRY_TEMPLATES.slice(0, 6).map((t, i) => ({
      ...t,
      id: i,
      insertedAt: now - INITIAL_OFFSETS_MS[i],
    }))
  )
  const [, tick] = useState(0)

  useEffect(() => {
    const addInterval = setInterval(() => {
      const template = ENTRY_TEMPLATES[templateIndexRef.current]
      templateIndexRef.current = (templateIndexRef.current + 1) % ENTRY_TEMPLATES.length

      setEntries((prev) => [
        { ...template, id: counterRef.current++, insertedAt: Date.now() },
        ...prev.slice(0, 5),
      ])
    }, 2600)

    // Refresh time labels every 5s so "just now" ages to "Xs ago"
    const tickInterval = setInterval(() => tick((n) => n + 1), 5_000)

    return () => {
      clearInterval(addInterval)
      clearInterval(tickInterval)
    }
  }, [])

  return (
    <div className='mt-5 overflow-hidden px-6 md:mt-6 md:px-8'>
      <AnimatePresence mode='popLayout' initial={false}>
        {entries.map((entry, index) => (
          <motion.div
            key={entry.id}
            layout
            initial={{ y: -48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              layout: {
                type: 'spring',
                stiffness: 380,
                damping: 38,
                mass: 0.8,
              },
              y: { duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] },
              opacity: { duration: 0.25 },
            }}
          >
            <AuditRow entry={entry} index={index} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

interface PermissionFeature {
  name: string
  key: string
  defaultEnabled: boolean
  providerId?: string
}

interface PermissionCategory {
  label: string
  color: string
  features: PermissionFeature[]
}

const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: 'Providers',
    color: '#FA4EDF',
    features: [
      { key: 'openai', name: 'OpenAI', defaultEnabled: true, providerId: 'openai' },
      { key: 'anthropic', name: 'Anthropic', defaultEnabled: true, providerId: 'anthropic' },
      { key: 'google', name: 'Google', defaultEnabled: false, providerId: 'google' },
      { key: 'xai', name: 'xAI', defaultEnabled: true, providerId: 'xai' },
    ],
  },
  {
    label: 'Workspace',
    color: '#2ABBF8',
    features: [
      { key: 'knowledge-base', name: 'Knowledge Base', defaultEnabled: true },
      { key: 'tables', name: 'Tables', defaultEnabled: true },
      { key: 'copilot', name: 'Copilot', defaultEnabled: false },
      { key: 'environment', name: 'Environment', defaultEnabled: false },
    ],
  },
  {
    label: 'Tools',
    color: '#33C482',
    features: [
      { key: 'mcp-tools', name: 'MCP Tools', defaultEnabled: true },
      { key: 'custom-tools', name: 'Custom Tools', defaultEnabled: false },
      { key: 'skills', name: 'Skills', defaultEnabled: true },
      { key: 'invitations', name: 'Invitations', defaultEnabled: true },
    ],
  },
]

const INITIAL_ACCESS_STATE = Object.fromEntries(
  PERMISSION_CATEGORIES.flatMap((category) =>
    category.features.map((feature) => [feature.key, feature.defaultEnabled])
  )
)

function CheckboxIcon({ checked, color }: { checked: boolean; color: string }) {
  return (
    <div
      className='h-[6px] w-[6px] shrink-0 rounded-full transition-colors duration-200'
      style={{
        backgroundColor: checked ? color : 'transparent',
        border: checked ? 'none' : '1.5px solid #3A3A3A',
      }}
    />
  )
}

function ProviderPreviewIcon({ providerId }: { providerId?: string }) {
  if (!providerId) return null

  const ProviderIcon = PROVIDER_DEFINITIONS[providerId]?.icon
  if (!ProviderIcon) return null

  return (
    <div className='relative flex h-[14px] w-[14px] shrink-0 items-center justify-center opacity-50 brightness-0 invert'>
      <ProviderIcon className='!h-[14px] !w-[14px]' />
    </div>
  )
}

function AccessControlPanel() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-40px' })
  const [accessState, setAccessState] = useState<Record<string, boolean>>(INITIAL_ACCESS_STATE)

  return (
    <div ref={ref}>
      <div className='lg:hidden'>
        {PERMISSION_CATEGORIES.map((category, catIdx) => {
          const offsetBefore = PERMISSION_CATEGORIES.slice(0, catIdx).reduce(
            (sum, c) => sum + c.features.length,
            0
          )

          return (
            <div key={category.label} className={catIdx > 0 ? 'mt-4' : ''}>
              <span className='font-[430] font-season text-[#F6F6F6]/30 text-[10px] uppercase leading-none tracking-[0.08em]'>
                {category.label}
              </span>
              <div className='mt-[8px] grid grid-cols-2 gap-x-4 gap-y-[8px]'>
                {category.features.map((feature, featIdx) => {
                  const enabled = accessState[feature.key]

                  return (
                    <motion.div
                      key={feature.key}
                      className='flex cursor-pointer items-center gap-[8px] rounded-[4px] py-[2px]'
                      initial={{ opacity: 0, x: -6 }}
                      animate={isInView ? { opacity: 1, x: 0 } : {}}
                      transition={{
                        delay: 0.05 + (offsetBefore + featIdx) * 0.04,
                        duration: 0.3,
                      }}
                      onClick={() =>
                        setAccessState((prev) => ({ ...prev, [feature.key]: !prev[feature.key] }))
                      }
                      whileTap={{ scale: 0.98 }}
                    >
                      <CheckboxIcon checked={enabled} color={category.color} />
                      <ProviderPreviewIcon providerId={feature.providerId} />
                      <span
                        className='truncate font-[430] font-season text-[13px] leading-none tracking-[0.02em]'
                        style={{ color: enabled ? '#F6F6F6AA' : '#F6F6F640' }}
                      >
                        {feature.name}
                      </span>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop — categorized grid */}
      <div className='hidden lg:block'>
        {PERMISSION_CATEGORIES.map((category, catIdx) => (
          <div key={category.label} className={catIdx > 0 ? 'mt-4' : ''}>
            <span className='font-[430] font-season text-[#F6F6F6]/30 text-[10px] uppercase leading-none tracking-[0.08em]'>
              {category.label}
            </span>
            <div className='mt-[8px] grid grid-cols-2 gap-x-4 gap-y-[8px]'>
              {category.features.map((feature, featIdx) => {
                const enabled = accessState[feature.key]
                const currentIndex =
                  PERMISSION_CATEGORIES.slice(0, catIdx).reduce(
                    (sum, c) => sum + c.features.length,
                    0
                  ) + featIdx

                return (
                  <motion.div
                    key={feature.key}
                    className='flex cursor-pointer items-center gap-[8px] rounded-[4px] py-[2px]'
                    initial={{ opacity: 0, x: -6 }}
                    animate={isInView ? { opacity: 1, x: 0 } : {}}
                    transition={{
                      delay: 0.1 + currentIndex * 0.04,
                      duration: 0.3,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                    onClick={() =>
                      setAccessState((prev) => ({ ...prev, [feature.key]: !prev[feature.key] }))
                    }
                    whileTap={{ scale: 0.98 }}
                  >
                    <CheckboxIcon checked={enabled} color={category.color} />
                    <ProviderPreviewIcon providerId={feature.providerId} />
                    <span
                      className='truncate font-[430] font-season text-[11px] leading-none tracking-[0.02em] transition-opacity duration-200'
                      style={{ color: enabled ? '#F6F6F6AA' : '#F6F6F640' }}
                    >
                      {feature.name}
                    </span>
                  </motion.div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

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

      {/* Open Source — center */}
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
              className='pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-16'
              style={{ background: 'linear-gradient(to right, #1C1C1C, transparent)' }}
            />
            <div
              aria-hidden='true'
              className='pointer-events-none absolute top-0 right-0 bottom-0 z-10 w-16'
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
            <Link
              href='https://form.typeform.com/to/jqCO12pF'
              target='_blank'
              rel='noopener noreferrer'
              className='group/cta inline-flex h-[32px] items-center gap-[6px] rounded-[5px] border border-white bg-white px-[10px] font-[430] font-season text-[14px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
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
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
