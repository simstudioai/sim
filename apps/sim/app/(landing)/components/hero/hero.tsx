'use client'

import React from 'react'
import {
  ArrowUp,
  BinaryIcon,
  BookIcon,
  BotIcon,
  BoxesIcon,
  CalendarIcon,
  HammerIcon,
  KeyIcon,
  LayersIcon,
  Mic,
  VariableIcon,
} from 'lucide-react'
import { type Edge, type Node, Position } from 'reactflow'
import { IconButton } from '@/components/icon-button'
import {
  AirtableIcon,
  DiscordIcon,
  GmailIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
  JiraIcon,
  LinearIcon,
  NotionIcon,
  OutlookIcon,
  PineconeIcon,
  SlackIcon,
  StripeIcon,
  SupabaseIcon,
} from '@/components/icons'
import { soehne } from '@/app/fonts/soehne/soehne'
import {
  CARD_WIDTH,
  LandingCanvas,
  type LandingGroupData,
  type LandingManualBlock,
  type LandingViewportApi,
} from './components/landing-canvas'

/**
 * Service-specific template messages for the hero input
 */
const SERVICE_TEMPLATES = {
  slack: 'Summarizer agent that summarizes each new message in #general and sends me a DM',
  gmail: 'Alert agent that summarizes each new Gmail in my Inbox and flags urgent threads',
  outlook:
    'Auto-forwarding agent that classifies each new Outlook email and forwards to separate inboxes for further analysis',
  pinecone: 'RAG chat agent that uses memories stored in Pinecone',
  supabase: 'Agent that uses Supabase to store context, run SQL, and produce weekly insights',
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
 * Sample workflow blocks for the canvas preview
 */
const SAMPLE_WORKFLOW_BLOCKS: LandingManualBlock[] = [
  {
    id: 'start',
    name: 'Start',
    color: '#30B2FF',
    icon: <KeyIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 24, y: 120 },
      tablet: { x: 60, y: 180 },
      desktop: { x: 80, y: 241 },
    },
    tags: [
      { icon: <CalendarIcon className='h-3 w-3' />, label: 'When: Call Received' },
      { icon: <VariableIcon className='h-3 w-3' />, label: '3 fields' },
    ],
  },
  {
    id: 'kb',
    name: 'Knowledge Base',
    color: '#01B0B0',
    icon: <BoxesIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 120, y: 140 },
      tablet: { x: 220, y: 200 },
      desktop: { x: 420, y: 241 },
    },
    tags: [
      { icon: <BookIcon className='h-3 w-3' />, label: 'Product Info' },
      { icon: <BinaryIcon className='h-3 w-3' />, label: 'Limit: 10' },
    ],
  },
  {
    id: 'reason',
    name: 'Agent',
    color: '#802FFF',
    icon: <BotIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 260, y: 80 },
      tablet: { x: 400, y: 120 },
      desktop: { x: 760, y: 60 },
    },
    tags: [
      { icon: <BotIcon className='h-3 w-3' />, label: 'Reasoning' },
      { icon: <LayersIcon className='h-3 w-3' />, label: 'gpt-5' },
      { icon: <HammerIcon className='h-3 w-3' />, label: '2 tools' },
    ],
  },
  {
    id: 'reply',
    name: 'Agent',
    color: '#802FFF',
    icon: <BotIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 400, y: 180 },
      tablet: { x: 600, y: 220 },
      desktop: { x: 760, y: 241 },
    },
    tags: [
      { icon: <BotIcon className='h-3 w-3' />, label: 'Generate Reply' },
      { icon: <LayersIcon className='h-3 w-3' />, label: 'gpt-5' },
    ],
  },
  {
    id: 'tts',
    name: 'Text-to-Speech',
    color: '#FFB300',
    icon: <Mic className='h-4 w-4' />,
    positions: {
      mobile: { x: 560, y: 120 },
      tablet: { x: 800, y: 160 },
      desktop: { x: 760, y: 400 },
    },
  },
]

/**
 * Sample workflow edges for the canvas preview
 */
const SAMPLE_WORKFLOW_EDGES = [
  { id: 'e1', from: 'start', to: 'kb' },
  { id: 'e2', from: 'kb', to: 'reason' },
  { id: 'e3', from: 'reason', to: 'reply' },
  { id: 'e4', from: 'reply', to: 'tts' },
]

/**
 * Hero component for the landing page featuring service integrations and workflow preview
 */
export default function Hero() {
  /**
   * State management for the text input
   */
  const [textValue, setTextValue] = React.useState('')
  const isEmpty = textValue.trim().length === 0

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
  const [autoHoverIndex, setAutoHoverIndex] = React.useState(0)
  const [isUserHovering, setIsUserHovering] = React.useState(false)
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null)

  /**
   * Handle service icon click to populate textarea with template
   */
  const handleServiceClick = (service: keyof typeof SERVICE_TEMPLATES) => {
    setTextValue(SERVICE_TEMPLATES[service])
  }

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
    { key: 'discord', icon: DiscordIcon, label: 'Discord' },
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
        setAutoHoverIndex((prev) => (prev + 1) % serviceIcons.length)
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
  }, [isUserHovering, serviceIcons.length])

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
  }

  /**
   * Handle form submission
   */
  const handleSubmit = () => {
    // Function left empty for now as requested
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

    // Convert sample blocks to React Flow nodes
    const nodes: Node[] = SAMPLE_WORKFLOW_BLOCKS.map((block, index) => ({
      id: block.id,
      type: 'landing',
      position: block.positions[breakpoint],
      data: {
        icon: block.icon,
        color: block.color,
        name: block.name,
        tags: block.tags,
        delay: index * 0.18,
      },
      draggable: false,
      selectable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }))

    // Convert sample edges to React Flow edges
    const rfEdges: Edge[] = SAMPLE_WORKFLOW_EDGES.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'landingEdge',
      animated: true,
      data: { delay: 0.3 },
      style: { strokeDasharray: '6 6', strokeWidth: 2, stroke: '#E1E1E1' },
    }))

    setRfNodes(nodes)
    setRfEdges(rfEdges)

    // Calculate world width for canvas
    const maxX = Math.max(...nodes.map((n) => n.position.x))
    setWorldWidth(maxX + CARD_WIDTH + 32)
  }, [])

  return (
    <div
      className={`${soehne.className} flex w-full flex-col items-center justify-center pt-[80px]`}
    >
      <h1 className='font-medium text-[74px] leading-none tracking-tight'>Workflows for LLMs</h1>
      <h2 className='pt-[16px] text-center font-normal text-[22px] opacity-70'>
        Build and deploy AI agent workflows
      </h2>
      <div
        className='flex items-center justify-center gap-[2px] pt-[32px]'
        onMouseEnter={handleIconContainerMouseEnter}
        onMouseLeave={handleIconContainerMouseLeave}
      >
        {/* Service integration buttons */}
        {serviceIcons.map((service, index) => {
          const Icon = service.icon
          return (
            <IconButton
              key={service.key}
              aria-label={service.label}
              onClick={() => handleServiceClick(service.key as keyof typeof SERVICE_TEMPLATES)}
              style={service.style}
              isAutoHovered={!isUserHovering && index === autoHoverIndex}
            >
              <Icon className='h-6 w-6' />
            </IconButton>
          )
        })}
      </div>
      <div className='relative flex items-center justify-center pt-[12px]'>
        <textarea
          placeholder='Ask Sim to build an agent to read my emails...'
          className='h-[120px] w-[640px] resize-none px-4 py-3 font-normal'
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
          className='absolute right-3 bottom-3 flex items-center justify-center transition-all duration-200'
          disabled={isEmpty}
          onClick={handleSubmit}
          style={{
            width: 34,
            height: 34,
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
          <ArrowUp size={20} color={isEmpty ? '#999999' : '#FFFFFF'} />
        </button>
      </div>

      {/* Workflow preview canvas */}
      <div className='mt-[100px] w-full max-w-[1273px]'>
        <LandingCanvas
          nodes={rfNodes}
          edges={rfEdges}
          groupBox={groupBox}
          worldWidth={worldWidth}
          viewportApiRef={viewportApiRef}
        />
      </div>
    </div>
  )
}
