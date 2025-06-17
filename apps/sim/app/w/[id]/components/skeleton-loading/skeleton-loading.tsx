'use client'

import { Bell, Bug, ChevronDown, Copy, History, Layers, Play, Rocket, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSidebarStore } from '@/stores/sidebar/store'

// Skeleton Components
const SkeletonControlBar = () => {
  return (
    <div className='flex h-16 w-full items-center justify-between border-b bg-background'>
      {/* Left Section - Workflow Name Skeleton */}
      <div className='flex flex-col gap-[2px] pl-4'>
        {/* Workflow name skeleton */}
        <Skeleton className='h-[20px] w-32' />
        {/* "Saved X time ago" skeleton */}
        <Skeleton className='h-3 w-24' />
      </div>

      {/* Middle Section */}
      <div className='flex-1' />

      {/* Right Section - Action Buttons with Real Icons */}
      <div className='flex items-center gap-1 pr-4'>
        {/* Delete Button */}
        <Button variant='ghost' size='icon' disabled className='opacity-60'>
          <Trash2 className='h-5 w-5' />
        </Button>

        {/* History Button */}
        <Button variant='ghost' size='icon' disabled className='opacity-60'>
          <History className='h-5 w-5' />
        </Button>

        {/* Notifications Button */}
        <Button variant='ghost' size='icon' disabled className='opacity-60'>
          <Bell className='h-5 w-5' />
        </Button>

        {/* Duplicate Button */}
        <Button variant='ghost' size='icon' disabled className='opacity-60'>
          <Copy className='h-5 w-5' />
        </Button>

        {/* Auto Layout Button */}
        <Button variant='ghost' size='icon' disabled className='opacity-60'>
          <Layers className='h-5 w-5' />
        </Button>

        {/* Debug Mode Button */}
        <Button variant='ghost' size='icon' disabled className='opacity-60'>
          <Bug className='h-5 w-5' />
        </Button>

        {/* Deploy Button */}
        <Button variant='ghost' size='icon' disabled className='opacity-60'>
          <Rocket className='h-5 w-5' />
        </Button>

        {/* Run Button with Dropdown */}
        <div className='ml-1 flex'>
          {/* Main Run Button */}
          <Button
            disabled
            className='h-10 gap-2 rounded-r-none border-r border-r-[#6420cc] bg-[#701FFC] px-4 py-2 font-medium text-white opacity-60'
          >
            <Play className='h-3.5 w-3.5 fill-current stroke-current' />
            Run
          </Button>

          {/* Dropdown Trigger */}
          <Button
            disabled
            className='h-10 rounded-l-none bg-[#701FFC] px-2 font-medium text-white opacity-60'
          >
            <ChevronDown className='h-4 w-4' />
          </Button>
        </div>
      </div>
    </div>
  )
}

const SkeletonPanelComponent = () => {
  return (
    <div className='fixed top-0 right-0 z-10'>
      {/* Panel skeleton */}
      <div className='h-96 w-80 space-y-4 rounded-bl-lg border-b border-l bg-background p-4'>
        {/* Tab headers skeleton */}
        <div className='flex gap-2 border-b pb-2'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-6 w-16' />
          ))}
        </div>

        {/* Content skeleton */}
        <div className='space-y-3'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-4' style={{ width: `${Math.random() * 40 + 60}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

const SkeletonNodes = () => {
  return [
    // Starter node skeleton
    {
      id: 'skeleton-starter',
      type: 'workflowBlock',
      position: { x: 100, y: 100 },
      data: {
        type: 'skeleton',
        config: { name: '', description: '', bgColor: '#9CA3AF' },
        name: '',
        isActive: false,
        isPending: false,
        isSkeleton: true,
      },
      dragHandle: '.workflow-drag-handle',
    },
    // Additional skeleton nodes
    {
      id: 'skeleton-node-1',
      type: 'workflowBlock',
      position: { x: 500, y: 100 },
      data: {
        type: 'skeleton',
        config: { name: '', description: '', bgColor: '#9CA3AF' },
        name: '',
        isActive: false,
        isPending: false,
        isSkeleton: true,
      },
      dragHandle: '.workflow-drag-handle',
    },
    {
      id: 'skeleton-node-2',
      type: 'workflowBlock',
      position: { x: 300, y: 300 },
      data: {
        type: 'skeleton',
        config: { name: '', description: '', bgColor: '#9CA3AF' },
        name: '',
        isActive: false,
        isPending: false,
        isSkeleton: true,
      },
      dragHandle: '.workflow-drag-handle',
    },
  ]
}

interface SkeletonLoadingProps {
  showSkeleton: boolean
  isSidebarCollapsed: boolean
  children: React.ReactNode
}

export function SkeletonLoading({
  showSkeleton,
  isSidebarCollapsed,
  children,
}: SkeletonLoadingProps) {
  const { mode, isExpanded } = useSidebarStore()

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden'>
      <div className={`transition-all duration-200 ${isSidebarCollapsed ? 'ml-14' : 'ml-60'}`}>
        {/* Skeleton Control Bar */}
        <div
          className={`transition-opacity duration-500 ${showSkeleton ? 'opacity-100' : 'pointer-events-none absolute opacity-0'}`}
          style={{ zIndex: showSkeleton ? 10 : -1 }}
        >
          <SkeletonControlBar />
        </div>

        {/* Real Control Bar */}
        <div
          className={`transition-opacity duration-500 ${showSkeleton ? 'pointer-events-none absolute opacity-0' : 'opacity-100'}`}
          style={{ zIndex: showSkeleton ? -1 : 10 }}
        >
          {children}
        </div>
      </div>

      {/* Real content will be rendered by children - sidebar will show its own loading state */}
    </div>
  )
}

export function SkeletonPanelWrapper({ showSkeleton }: { showSkeleton: boolean }) {
  return (
    <div
      className={`transition-opacity duration-500 ${showSkeleton ? 'opacity-100' : 'pointer-events-none absolute opacity-0'}`}
      style={{ zIndex: showSkeleton ? 10 : -1 }}
    >
      <SkeletonPanelComponent />
    </div>
  )
}

export { SkeletonNodes, SkeletonPanelComponent }
