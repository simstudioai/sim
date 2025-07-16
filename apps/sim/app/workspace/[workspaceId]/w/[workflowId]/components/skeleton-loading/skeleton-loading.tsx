'use client'

import { Bug, Copy, Layers, Play, Rocket, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const SkeletonControlBar = () => {
  return (
    <div className='fixed top-4 right-4 z-20 flex items-center gap-1'>
      {/* Delete Button */}
      <Button
        variant='outline'
        className='h-12 w-12 cursor-not-allowed rounded-[11px] border-[hsl(var(--card-border))] bg-[hsl(var(--card-background))] text-[hsl(var(--card-text))] opacity-50 shadow-xs hover:border-[hsl(var(--card-border))] hover:bg-[hsl(var(--card-background))]'
        disabled
      >
        <Trash2 className='h-5 w-5' />
      </Button>

      {/* Duplicate Button */}
      <Button
        variant='outline'
        className='h-12 w-12 cursor-not-allowed rounded-[11px] border-[hsl(var(--card-border))] bg-[hsl(var(--card-background))] text-[hsl(var(--card-text))] opacity-50 shadow-xs hover:border-[hsl(var(--card-border))] hover:bg-[hsl(var(--card-background))] hover:bg-gray-100'
        disabled
      >
        <Copy className='h-5 w-5' />
      </Button>

      {/* Auto Layout Button */}
      <Button
        variant='outline'
        className='h-12 w-12 cursor-not-allowed rounded-[11px] border-[hsl(var(--card-border))] bg-[hsl(var(--card-background))] text-[hsl(var(--card-text))] opacity-50 shadow-xs hover:border-[hsl(var(--card-border))] hover:bg-[hsl(var(--card-background))] hover:bg-gray-100'
        disabled
      >
        <Layers className='h-5 w-5' />
      </Button>

      {/* Debug Mode Button */}
      <Button
        variant='outline'
        className='h-12 w-12 cursor-not-allowed rounded-[11px] border-[hsl(var(--card-border))] bg-[hsl(var(--card-background))] text-[hsl(var(--card-text))] opacity-50 shadow-xs hover:border-[hsl(var(--card-border))] hover:bg-[hsl(var(--card-background))] hover:bg-gray-100'
        disabled
      >
        <Bug className='h-5 w-5' />
      </Button>

      {/* Deploy Button */}
      <Button
        variant='outline'
        className='h-12 w-12 cursor-not-allowed rounded-[11px] border-[hsl(var(--card-border))] bg-[hsl(var(--card-background))] text-[hsl(var(--card-text))] opacity-50 shadow-xs hover:border-[hsl(var(--card-border))] hover:bg-[hsl(var(--card-background))] hover:bg-gray-100'
        disabled
      >
        <Rocket className='h-5 w-5' />
      </Button>

      {/* Run Button */}
      <Button
        className='h-12 cursor-not-allowed gap-2 rounded-[11px] bg-[#701FFC] px-4 py-2 font-medium text-white shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:opacity-50 disabled:hover:bg-[#701FFC] disabled:hover:shadow-none'
        disabled
      >
        <Play className='h-3.5 w-3.5 fill-current stroke-current' />
      </Button>
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
  return (
    <div className='flex h-screen w-full flex-col overflow-hidden pl-64'>
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
