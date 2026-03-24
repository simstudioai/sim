'use client'

import { useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

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

export function AccessControlPanel() {
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

      {/* Desktop -- categorized grid */}
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
