'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, Layout, Search, Settings } from 'lucide-react'
import { ChevronDown, Library } from '@/components/emcn'
import type { PreviewWorkflow } from '@/app/(home)/components/hero/components/hero-preview/components/hero-preview-workflow/workflow-data'

/**
 * Props for the HeroPreviewSidebar component
 */
interface HeroPreviewSidebarProps {
  workflows: PreviewWorkflow[]
  activeWorkflowId: string
  onSelectWorkflow: (id: string) => void
}

/**
 * Static footer navigation items matching the real sidebar
 */
const FOOTER_NAV_ITEMS = [
  { id: 'logs', label: 'Logs', icon: Library },
  { id: 'templates', label: 'Templates', icon: Layout },
  { id: 'knowledge-base', label: 'Knowledge Base', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

/**
 * Lightweight static sidebar replicating the real workspace sidebar styling.
 * Only workflow items are interactive — everything else is pointer-events-none.
 *
 * Colors sourced from the dark theme CSS variables:
 * --surface-1: #1e1e1e, --surface-5: #363636, --border: #2c2c2c, --border-1: #3d3d3d
 * --text-primary: #e6e6e6, --text-tertiary: #b3b3b3, --text-muted: #787878
 */
export function HeroPreviewSidebar({
  workflows,
  activeWorkflowId,
  onSelectWorkflow,
}: HeroPreviewSidebarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleToggle = useCallback(() => {
    setIsDropdownOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    if (!isDropdownOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isDropdownOpen])

  return (
    <div className='flex h-full w-[220px] flex-shrink-0 flex-col border-[#2c2c2c] border-r bg-[#1e1e1e]'>
      {/* Header */}
      <div className='relative flex-shrink-0 px-[14px] pt-[12px]' ref={dropdownRef}>
        <div className='flex items-center justify-between'>
          <button
            type='button'
            onClick={handleToggle}
            className='group -mx-[6px] flex cursor-pointer items-center gap-[8px] rounded-[6px] bg-transparent px-[6px] py-[4px] transition-colors hover:bg-[#363636]'
          >
            <span className='truncate font-base text-[#e6e6e6] text-[14px]'>My Workspace</span>
            <ChevronDown
              className={`h-[8px] w-[10px] flex-shrink-0 text-[#787878] transition-all duration-100 group-hover:text-[#cccccc] ${isDropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <div className='pointer-events-none flex flex-shrink-0 items-center'>
            <Search className='h-[14px] w-[14px] text-[#787878]' />
          </div>
        </div>

        {/* Workspace switcher dropdown */}
        {isDropdownOpen && (
          <div className='absolute top-[42px] left-[8px] z-50 min-w-[160px] max-w-[160px] rounded-[6px] bg-[#242424] px-[6px] py-[6px] shadow-lg'>
            <div
              className='flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[6px] bg-[#3d3d3d] px-[6px] font-base text-[#e6e6e6] text-[13px]'
              role='menuitem'
              onClick={() => setIsDropdownOpen(false)}
            >
              <span className='min-w-0 flex-1 truncate'>My Workspace</span>
            </div>
          </div>
        )}
      </div>

      {/* Workflow items */}
      <div className='mt-[8px] space-y-[2px] overflow-x-hidden px-[8px]'>
        {workflows.map((workflow) => {
          const isActive = workflow.id === activeWorkflowId
          return (
            <button
              key={workflow.id}
              type='button'
              onClick={() => onSelectWorkflow(workflow.id)}
              className={`group flex h-[26px] w-full items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] transition-colors ${
                isActive ? 'bg-[#363636]' : 'bg-transparent hover:bg-[#363636]'
              }`}
            >
              <div
                className='h-[14px] w-[14px] flex-shrink-0 rounded-[4px]'
                style={{ backgroundColor: workflow.color }}
              />
              <div className='min-w-0 flex-1'>
                <div
                  className={`min-w-0 truncate text-left font-medium ${
                    isActive ? 'text-[#e6e6e6]' : 'text-[#b3b3b3] group-hover:text-[#e6e6e6]'
                  }`}
                >
                  {workflow.name}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer navigation — static */}
      <div className='pointer-events-none mt-auto flex flex-shrink-0 flex-col gap-[2px] border-[#2c2c2c] border-t px-[7.75px] pt-[8px] pb-[8px]'>
        {FOOTER_NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.id}
              className='flex h-[26px] items-center gap-[8px] rounded-[8px] px-[6px] text-[14px]'
            >
              <Icon className='h-[14px] w-[14px] flex-shrink-0 text-[#b3b3b3]' />
              <span className='truncate font-medium text-[#b3b3b3] text-[13px]'>{item.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
