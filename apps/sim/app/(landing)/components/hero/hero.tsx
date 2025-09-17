'use client'

import React from 'react'
import {
  ArrowUp,
  BinaryIcon,
  BookIcon,
  CalendarIcon,
  CodeIcon,
  Globe2Icon,
  MessageSquareIcon,
  VariableIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type Edge, type Node, Position } from 'reactflow'
import {
  AgentIcon,
  AirtableIcon,
  DiscordIcon,
  GmailIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
  JiraIcon,
  LinearIcon,
  NotionIcon,
  OpenAIIcon,
  OutlookIcon,
  PackageSearchIcon,
  PineconeIcon,
  ScheduleIcon,
  SlackIcon,
  StripeIcon,
  SupabaseIcon,
} from '@/components/icons'
import { LandingPromptStorage } from '@/lib/browser-storage'
import { soehne } from '@/app/fonts/soehne/soehne'
import {
  CARD_WIDTH,
  IconButton,
  LandingCanvas,
  type LandingGroupData,
  type LandingManualBlock,
  type LandingViewportApi,
} from './components'

/**
 * Service-specific template messages for the hero input
 */
const SERVICE_TEMPLATES = {
  slack: 'Summarizer agent that summarizes each new message in #general and sends me a DM',
  gmail: 'Alert agent that flags important Gmail messages in my inbox',
  outlook:
    'Auto-forwarding agent that classifies each new Outlook email and forwards to separate inboxes for further analysis',
  pinecone: 'RAG chat agent that uses memories stored in Pinecone',
  supabase: 'Natural language to SQL agent to query and update data in Supabase',
  linear: 'Agent that uses Linear to triage issues, assign owners, and draft updates',
  discord: 'Moderator agent that responds back to users in my Discord server',
  airtable: 'Alert agent that validates each new record in a table and prepares a weekly report',
  stripe: 'Agent that analyzes Stripe payment history to spot churn risks and generate summaries',
  notion: 'Support agent that appends new support tickets to my Notion workspace',
  googleSheets: 'Data science agent that analyzes Google Sheets data and generates insights',
  googleDrive: 'Drive reader agent that summarizes content in my Google Drive',
  jira: 'Engineering manager agent that uses Jira to update ticket statuses, generate sprint reports, and identify blockers',
} as const

/**
 * Landing blocks for the canvas preview
 */
const LANDING_BLOCKS: LandingManualBlock[] = [
  {
    id: 'schedule',
    name: 'Schedule',
    color: '#7B68EE',
    icon: <ScheduleIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 8, y: 60 },
      tablet: { x: 40, y: 120 },
      desktop: { x: 60, y: 180 },
    },
    tags: [
      { icon: <CalendarIcon className='h-3 w-3' />, label: '09:00AM Daily' },
      { icon: <Globe2Icon className='h-3 w-3' />, label: 'PST' },
    ],
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    color: '#00B0B0',
    icon: <PackageSearchIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 120, y: 140 },
      tablet: { x: 220, y: 200 },
      desktop: { x: 420, y: 241 },
    },
    tags: [
      { icon: <BookIcon className='h-3 w-3' />, label: 'Product Vector DB' },
      { icon: <BinaryIcon className='h-3 w-3' />, label: 'Limit: 10' },
    ],
  },
  {
    id: 'agent',
    name: 'Agent',
    color: '#802FFF',
    icon: <AgentIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 340, y: 60 },
      tablet: { x: 540, y: 120 },
      desktop: { x: 880, y: 142 },
    },
    tags: [
      { icon: <OpenAIIcon className='h-3 w-3' />, label: 'gpt-5' },
      { icon: <MessageSquareIcon className='h-3 w-3' />, label: 'You are a support ag...' },
    ],
  },
  {
    id: 'function',
    name: 'Function',
    color: '#FF402F',
    icon: <CodeIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 480, y: 220 },
      tablet: { x: 740, y: 280 },
      desktop: { x: 880, y: 340 },
    },
    tags: [
      { icon: <CodeIcon className='h-3 w-3' />, label: 'Python' },
      { icon: <VariableIcon className='h-3 w-3' />, label: 'time = "2025-09-01...' },
    ],
  },
]

/**
 * Sample workflow edges for the canvas preview
 */
const SAMPLE_WORKFLOW_EDGES = [
  { id: 'e1', from: 'schedule', to: 'knowledge' },
  { id: 'e2', from: 'knowledge', to: 'agent' },
  { id: 'e3', from: 'knowledge', to: 'function' },
]

/**
 * Hero component for the landing page featuring service integrations and workflow preview
 */
export default function Hero() {
  const router = useRouter()

  /**
   * State management for the text input
   */
  const [textValue, setTextValue] = React.useState('')
  const isEmpty = textValue.trim().length === 0

  /**
   * State for responsive icon display
   */
  const [visibleIconCount, setVisibleIconCount] = React.useState(13)
  const [isMobile, setIsMobile] = React.useState(false)

  /**
   * React Flow state for workflow preview canvas
   */
  const [rfNodes, setRfNodes] = React.useState<Node[]>([])
  const [rfEdges, setRfEdges] = React.useState<Edge[]>([])
  const [groupBox, setGroupBox] = React.useState<LandingGroupData | null>(null)
  const [worldWidth, setWorldWidth] = React.useState<number>(1000)
  const viewportApiRef = React.useRef<LandingViewportApi | null>(null)

  /**
   * Auto-hover animation state
   */
  const [autoHoverIndex, setAutoHoverIndex] = React.useState(1)
  const [isUserHovering, setIsUserHovering] = React.useState(false)
  const [lastHoveredIndex, setLastHoveredIndex] = React.useState<number | null>(null)
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null)

  /**
   * Handle service icon click to populate textarea with template
   */
  const handleServiceClick = (service: keyof typeof SERVICE_TEMPLATES) => {
    setTextValue(SERVICE_TEMPLATES[service])
  }

  /**
   * Set visible icon count based on screen size
   */
  React.useEffect(() => {
    const updateVisibleIcons = () => {
      if (typeof window !== 'undefined') {
        const mobile = window.innerWidth < 640
        setVisibleIconCount(mobile ? 6 : 13)
        setIsMobile(mobile)
      }
    }

    updateVisibleIcons()
    window.addEventListener('resize', updateVisibleIcons)

    return () => window.removeEventListener('resize', updateVisibleIcons)
  }, [])

  /**
   * Service icons array for easier indexing
   */
  const serviceIcons: Array<{
    key: string
    icon: React.ComponentType<{ className?: string }>
    label: string
    style?: React.CSSProperties
  }> = [
    { key: 'slack', icon: SlackIcon, label: 'Slack' },
    { key: 'gmail', icon: GmailIcon, label: 'Gmail' },
    { key: 'outlook', icon: OutlookIcon, label: 'Outlook' },
    { key: 'pinecone', icon: PineconeIcon, label: 'Pinecone' },
    { key: 'supabase', icon: SupabaseIcon, label: 'Supabase' },
    { key: 'linear', icon: LinearIcon, label: 'Linear', style: { color: '#5E6AD2' } },
    { key: 'discord', icon: DiscordIcon, label: 'Discord', style: { color: '#5765F2' } },
    { key: 'airtable', icon: AirtableIcon, label: 'Airtable' },
    { key: 'stripe', icon: StripeIcon, label: 'Stripe' },
    { key: 'notion', icon: NotionIcon, label: 'Notion' },
    { key: 'googleSheets', icon: GoogleSheetsIcon, label: 'Google Sheets' },
    { key: 'googleDrive', icon: GoogleDriveIcon, label: 'Google Drive' },
    { key: 'jira', icon: JiraIcon, label: 'Jira' },
  ]

  /**
   * Auto-hover animation effect
   */
  React.useEffect(() => {
    // Start the interval when component mounts
    const startInterval = () => {
      intervalRef.current = setInterval(() => {
        setAutoHoverIndex((prev) => (prev + 1) % visibleIconCount)
      }, 2000)
    }

    // Only run interval when user is not hovering
    if (!isUserHovering) {
      startInterval()
    }

    // Cleanup on unmount or when hovering state changes
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isUserHovering, visibleIconCount])

  /**
   * Handle mouse enter on icon container
   */
  const handleIconContainerMouseEnter = () => {
    setIsUserHovering(true)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
  }

  /**
   * Handle mouse leave on icon container
   */
  const handleIconContainerMouseLeave = () => {
    setIsUserHovering(false)
    // Start from the next icon after the last hovered one
    if (lastHoveredIndex !== null) {
      setAutoHoverIndex((lastHoveredIndex + 1) % visibleIconCount)
    }
  }

  /**
   * Handle form submission
   */
  const handleSubmit = () => {
    if (!isEmpty) {
      LandingPromptStorage.store(textValue)
      router.push('/signup')
    }
  }

  /**
   * Handle keyboard shortcuts (Enter to submit)
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isEmpty) {
        handleSubmit()
      }
    }
  }

  /**
   * Initialize workflow preview with sample data
   */
  React.useEffect(() => {
    // Determine breakpoint for responsive positioning
    const breakpoint =
      typeof window !== 'undefined' && window.innerWidth < 640
        ? 'mobile'
        : typeof window !== 'undefined' && window.innerWidth < 1024
          ? 'tablet'
          : 'desktop'

    // Convert landing blocks to React Flow nodes
    const nodes: Node[] = [
      // Add the loop block node as a group with custom rendering
      {
        id: 'loop',
        type: 'group',
        position: { x: 720, y: 20 },
        data: {
          label: 'Loop',
        },
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
        // Group node properties for subflow functionality
        style: {
          width: 1198,
          height: 528,
          backgroundColor: 'transparent',
          border: 'none',
          padding: 0,
        },
      },
      // Convert blocks to nodes
      ...LANDING_BLOCKS.map((block, index) => {
        // Make agent and function nodes children of the loop
        const isLoopChild = block.id === 'agent' || block.id === 'function'
        const baseNode = {
          id: block.id,
          type: 'landing',
          position: isLoopChild
            ? {
                // Adjust positions relative to loop parent (original positions - loop position)
                x: block.id === 'agent' ? 160 : 160,
                y: block.id === 'agent' ? 122 : 320,
              }
            : block.positions[breakpoint],
          data: {
            icon: block.icon,
            color: block.color,
            name: block.name,
            tags: block.tags,
            delay: index * 0.18,
            hideTargetHandle: block.id === 'schedule', // Hide target handle for schedule node
            hideSourceHandle: block.id === 'agent' || block.id === 'function', // Hide source handle for agent and function nodes
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        }

        // Add parent properties for loop children
        if (isLoopChild) {
          return {
            ...baseNode,
            parentId: 'loop',
            extent: 'parent',
          }
        }

        return baseNode
      }),
    ]

    // Convert sample edges to React Flow edges
    const rfEdges: Edge[] = SAMPLE_WORKFLOW_EDGES.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'landingEdge',
      animated: false,
      data: { delay: 0.6 },
    }))

    setRfNodes(nodes)
    setRfEdges(rfEdges)

    // Calculate world width for canvas
    const maxX = Math.max(...nodes.map((n) => n.position.x))
    setWorldWidth(maxX + CARD_WIDTH + 32)
  }, [])

  return (
    <section
      id='hero'
      className={`${soehne.className} flex w-full flex-col items-center justify-center pt-[36px] sm:pt-[80px]`}
      aria-labelledby='hero-heading'
    >
      <h1
        id='hero-heading'
        className='px-4 text-center font-medium text-[36px] leading-none tracking-tight sm:px-0 sm:text-[74px]'
      >
        Workflows for LLMs
      </h1>
      <p className='px-4 pt-[6px] text-center text-[18px] opacity-70 sm:px-0 sm:pt-[10px] sm:text-[22px]'>
        Build and deploy AI agent workflows
      </p>
      <div
        className='flex items-center justify-center gap-[2px] pt-[18px] sm:pt-[32px]'
        onMouseEnter={handleIconContainerMouseEnter}
        onMouseLeave={handleIconContainerMouseLeave}
      >
        {/* Service integration buttons */}
        {serviceIcons.slice(0, visibleIconCount).map((service, index) => {
          const Icon = service.icon
          return (
            <IconButton
              key={service.key}
              aria-label={service.label}
              onClick={() => handleServiceClick(service.key as keyof typeof SERVICE_TEMPLATES)}
              onMouseEnter={() => setLastHoveredIndex(index)}
              style={service.style}
              isAutoHovered={!isUserHovering && index === autoHoverIndex}
            >
              <Icon className='h-5 w-5 sm:h-6 sm:w-6' />
            </IconButton>
          )
        })}
      </div>
      <div className='flex w-full items-center justify-center px-4 pt-[8px] sm:px-8 sm:pt-[12px] md:px-[50px]'>
        <div className='relative w-full sm:w-[640px]'>
          <label htmlFor='agent-description' className='sr-only'>
            Describe the AI agent you want to build
          </label>
          <textarea
            id='agent-description'
            placeholder={
              isMobile ? 'Build an AI agent...' : 'Ask Sim to build an agent to read my emails...'
            }
            className='h-[100px] w-full resize-none px-3 py-2.5 text-sm sm:h-[120px] sm:px-4 sm:py-3 sm:text-base'
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              borderRadius: 16,
              border: 'var(--border-width-border, 1px) solid #E5E5E5',
              outline: 'none',
              background: '#FFFFFF',
              boxShadow:
                'var(--shadow-xs-offset-x, 0) var(--shadow-xs-offset-y, 2px) var(--shadow-xs-blur-radius, 4px) var(--shadow-xs-spread-radius, 0) var(--shadow-xs-color, rgba(0, 0, 0, 0.08))',
            }}
          />
          <button
            key={isEmpty ? 'empty' : 'filled'}
            type='button'
            aria-label='Submit description'
            className='absolute right-2.5 bottom-4 flex h-[30px] w-[30px] items-center justify-center transition-all duration-200 sm:right-[11px] sm:bottom-[16px] sm:h-[34px] sm:w-[34px]'
            disabled={isEmpty}
            onClick={handleSubmit}
            style={{
              padding: '3.75px 3.438px 3.75px 4.063px',
              borderRadius: 55,
              ...(isEmpty
                ? {
                    border: '0.625px solid #E0E0E0',
                    background: '#E5E5E5',
                    boxShadow: 'none',
                    cursor: 'not-allowed',
                  }
                : {
                    border: '0.625px solid #343434',
                    background: 'linear-gradient(180deg, #060606 0%, #323232 100%)',
                    boxShadow: '0 1.25px 2.5px 0 #9B77FF inset',
                    cursor: 'pointer',
                  }),
            }}
          >
            <ArrowUp size={18} className='sm:h-5 sm:w-5' color={isEmpty ? '#999999' : '#FFFFFF'} />
          </button>
        </div>
      </div>

      {/* Canvas - hidden on mobile */}
      {!isMobile && (
        <div className='mt-[60px] w-full max-w-[1308px] sm:mt-[127.5px]'>
          <LandingCanvas
            nodes={rfNodes}
            edges={rfEdges}
            groupBox={groupBox}
            worldWidth={worldWidth}
            viewportApiRef={viewportApiRef}
          />
        </div>
      )}
    </section>
  )
}
