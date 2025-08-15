"use client"

import React from 'react'
// import Image from 'next/image'
import Link from 'next/link'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Mic, Mail, User, MessageSquare, Check, ArrowUp, BookIcon, ChevronUpIcon, ChevronDownIcon, KeyIcon, BoxesIcon, BinaryIcon, CalendarIcon, VariableIcon, BotIcon, LayersIcon, HammerIcon } from 'lucide-react'
import { DotPattern } from '../dot-pattern'
import { GmailIcon, SlackIcon } from '@/components/icons'
import { gsap } from 'gsap'
import ReactFlow, { ReactFlowProvider, useReactFlow, Handle, Position, BaseEdge, getSmoothStepPath, type EdgeProps, type Edge, type Node } from 'reactflow'
import 'reactflow/dist/style.css'

// Visual constants for workflow nodes
const CARD_WIDTH = 256
const CARD_HEIGHT = 92
// Public viewport control surface used by the landing timeline
type LandingViewportApi = {
  panTo: (x: number, y: number, options?: { duration?: number }) => void
  getViewport: () => { x: number; y: number; zoom: number }
}


// Lazy-register plugins only on client
if (typeof window !== 'undefined') {
  // TextPlugin is bundled under gsap/all in ESM, but we can simulate typing without it.
}

const FireIcon = () => {
  return (
      <p className='text-sm'>🔥</p>
  )
}

const AGENT_OPTIONS = [
  { value: 'web-scrape', label: 'Web Scrape Agent', icon: FireIcon },
  { value: 'gmail', label: 'Gmail Agent', icon: GmailIcon },
  { value: 'leadgen', label: 'LeadGen Agent', icon: User },
  { value: 'slack', label: 'Slack Agent', icon: SlackIcon },
  { value: 'task', label: 'Task Agent', icon: Check },
] as const

const MODES = [
  { value: "agent", label: "Agent", icon: <BookIcon className='text-muted-foreground h-3 w-3' /> },
  { value: "ask", label: "Ask", icon: <MessageSquare className='text-muted-foreground h-3 w-3' /> },
] as const

function Hero() {
  // Build an immediate, non-blank preview for first paint (desktop positions fallback)
  function buildInitialPreview(): { nodes: Node[]; edges: Edge[]; worldW: number } {
    const pad = 16
    const blocks: WorkflowManualBlock[] = [
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
    const edgesSpec: WorkflowEdgeData[] = [
      { id: 'e1', from: 'start', to: 'kb' },
      { id: 'e2', from: 'kb', to: 'reason' },
      { id: 'e3', from: 'reason', to: 'reply' },
      { id: 'e4', from: 'reply', to: 'tts' },
    ]
    const bp = 'desktop' as const
    const nodesBase = blocks.map((b) => {
      const pos = b.positions[bp]
      const nx = Math.max(pad, pos.x)
      const ny = Math.max(pad, pos.y)
      return { id: b.id, x: nx, y: ny, name: b.name, color: b.color, icon: b.icon, tags: b.tags }
    }) as WorkflowBlockNode[]
    const maxRight = nodesBase.reduce((m, n) => Math.max(m, n.x), 0)
    const worldW = maxRight + CARD_WIDTH + pad
    const ordered = [...nodesBase].sort((a, b) => (a.x - b.x) || (a.y - b.y))
    const idToDelay = new Map<string, number>()
    ordered.forEach((n, i) => idToDelay.set(n.id, i * 0.18))
    const nodes: Node[] = nodesBase.map((b) => ({
      id: b.id,
      type: 'landing',
      position: { x: b.x, y: b.y },
      data: { icon: b.icon, color: b.color, name: b.name, tags: b.tags, delay: idToDelay.get(b.id) ?? 0, instant: true },
      draggable: false,
      selectable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }))
    const edges: Edge[] = edgesSpec.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'landingEdge',
      animated: false,
      data: { delay: 0, instant: true },
      style: { strokeDasharray: '6 6', strokeWidth: 2, stroke: '#E1E1E1', opacity: 1 },
    }))
    return { nodes, edges, worldW }
  }

  const initialPreview = buildInitialPreview()

  const [prompt, setPrompt] = React.useState<string>("")
  const [mode, setMode] = React.useState<"agent" | "ask">("agent")
  const [isRunning, setIsRunning] = React.useState(false)
  // React Flow data
  const [rfNodes, setRfNodes] = React.useState<Node[]>(() => initialPreview.nodes)
  const [rfEdges, setRfEdges] = React.useState<Edge[]>(() => initialPreview.edges)
  const [groupBox, setGroupBox] = React.useState<WorkflowGroupData | null>(null)
  const [autoPlay, setAutoPlay] = React.useState(true)
  const [isCondensed, setIsCondensed] = React.useState(false)
  const [worldWidth, setWorldWidth] = React.useState<number>(() => initialPreview.worldW)
  const [isMobile, setIsMobile] = React.useState(false)

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const textareaWrapRef = React.useRef<HTMLDivElement | null>(null)
  const textareaSizerRef = React.useRef<HTMLDivElement | null>(null)
  const sendBtnRef = React.useRef<HTMLButtonElement | null>(null)
  const modeTagRef = React.useRef<HTMLDivElement | null>(null)
  const flowWrapRef = React.useRef<HTMLDivElement | null>(null)
  const previewRef = React.useRef<HTMLDivElement | null>(null)
  const tlRef = React.useRef<gsap.core.Timeline | null>(null)
  const pulseRef = React.useRef<gsap.core.Tween | null>(null)
  type LandingViewportApi = { panTo: (x: number, y: number, options?: { duration?: number }) => void; getViewport: () => { x: number; y: number; zoom: number } }
  const viewportApiRef = React.useRef<LandingViewportApi | null>(null)

  // Animation timings (ms)
  const COLLAPSE_MS = 2200
  const EXPAND_MS = 600

  // Fit the textarea height to its content and return the resulting height in px
  const ensureTextareaAutosize = React.useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return 0
    ta.style.height = 'auto'
    const style = window.getComputedStyle(ta)
    const borderV = Number.parseFloat(style.borderTopWidth || '0') + Number.parseFloat(style.borderBottomWidth || '0')
    const contentHeight = Math.ceil(ta.scrollHeight + borderV)
    ta.style.height = `${contentHeight}px`
    return contentHeight
  }, [])

  // Compute the textarea's ideal content height without mutating its current height
  const computeTextareaContentHeight = React.useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return 0
    const prev = ta.style.height
    ta.style.height = 'auto'
    const style = window.getComputedStyle(ta)
    const borderV = Number.parseFloat(style.borderTopWidth || '0') + Number.parseFloat(style.borderBottomWidth || '0')
    const h = Math.ceil(ta.scrollHeight + borderV)
    ta.style.height = prev
    return h
  }, [])

  // Animate textarea height to a target with easing; cleans up inline transition styles
  const animateTextareaHeightTo = React.useCallback((targetPx: number, durationMs: number, easing: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const startH = ta.getBoundingClientRect().height
    ta.style.height = `${startH}px`
    ta.style.overflow = 'hidden'
    ta.style.willChange = 'height'
    ta.style.transition = `height ${durationMs}ms ${easing}`
    void ta.getBoundingClientRect().height
    requestAnimationFrame(() => { ta.style.height = `${targetPx}px` })
    const cleanup = () => {
      ta.style.removeProperty('overflow')
      ta.style.removeProperty('will-change')
      ta.style.removeProperty('transition')
      ta.removeEventListener('transitionend', cleanup)
    }
    ta.addEventListener('transitionend', cleanup, { once: true })
    window.setTimeout(cleanup, durationMs + 120)
  }, [])
  
  const handleSend = React.useCallback(() => {
    const base = '/signup'
    const url = prompt && prompt.trim().length > 0 ? `${base}?prompt=${encodeURIComponent(prompt.trim())}` : base
    if (typeof window !== 'undefined') {
      window.open(url, '_blank')
    }
  }, [prompt])

  const stopAuto = React.useCallback(() => {
    setAutoPlay(false)
    setIsRunning(false)
    setIsCondensed(false)
    // Kill animations
    tlRef.current?.kill()
    tlRef.current = null
    pulseRef.current?.kill()
    pulseRef.current = null
    // Reveal controls
    if (sendBtnRef.current) gsap.set(sendBtnRef.current, { clearProps: 'all', autoAlpha: 1, scale: 1 })
    if (modeTagRef.current) gsap.set(modeTagRef.current, { clearProps: 'all', autoAlpha: 1, scale: 1 })
    if (textareaWrapRef.current) gsap.set(textareaWrapRef.current, { boxShadow: 'none', clearProps: 'height' })
  }, [])

  React.useEffect(() => {
    if (!autoPlay) return
    if (typeof window === 'undefined') return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    if (reduceMotion) return

    // Dummy prompts and workflows (manual positions per breakpoint)
    const PROMPTS: GridPrompt[] = [
      {
        text: 'Create a voice agent that answers support calls and searches the KB.',
        blocks: [
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
            tags: [{ icon: <CalendarIcon className='h-3 w-3' />, label: 'When: Call Received' }, { icon: <VariableIcon className='h-3 w-3' />, label: '3 fields' }],
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
            tags: [{ icon: <BookIcon className='h-3 w-3' />, label: 'Product Info' }, { icon: <BinaryIcon className='h-3 w-3' />, label: 'Limit: 10' }],
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
            tags: [{ icon: <BotIcon className='h-3 w-3' />, label: 'Reasoning' }, { icon: <LayersIcon className='h-3 w-3' />, label: 'gpt-5' }, { icon: <HammerIcon className='h-3 w-3' />, label: '2 tools' }],
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
            tags: [{ icon: <BotIcon className='h-3 w-3' />, label: 'Generate Reply' }, { icon: <LayersIcon className='h-3 w-3' />, label: 'gpt-5' }],
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
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'kb' },
          { id: 'e2', from: 'kb', to: 'reason' },
          { id: 'e3', from: 'reason', to: 'reply' },
          { id: 'e4', from: 'reply', to: 'tts' },
        ],
      },
      {
        text: 'Summarize today’s emails and post updates to Slack channels.',
        blocks: [
          {
            id: 'start',
            name: 'Start',
            color: '#6F3DFA',
            icon: <BookIcon className='h-4 w-4' />,
            positions: {
              mobile: { x: 16, y: 40 },
              tablet: { x: 40, y: 160 },
              desktop: { x: 80, y: 160 },
            },
          },
          {
            id: 'stripe',
            name: 'Stripe',
            color: '#635BFF',
            icon: <FireIcon />,
            positions: {
              mobile: { x: 16, y: 130 },
              tablet: { x: 300, y: 160 },
              desktop: { x: 360, y: 160 },
            },
          },
          {
            id: 'gmail1',
            name: 'Gmail',
            color: '#EA4335',
            icon: <Mail className='h-4 w-4' />,
            tags: [{ icon: <GmailIcon className='h-3 w-3' />, label: 'Search Messages' }],
            positions: {
              mobile: { x: 16, y: 220 },
              tablet: { x: 560, y: 120 },
              desktop: { x: 640, y: 120 },
            },
          },
          {
            id: 'gmail2',
            name: 'Gmail',
            color: '#EA4335',
            icon: <Mail className='h-4 w-4' />,
            tags: [{ icon: <GmailIcon className='h-3 w-3' />, label: 'Get Messages' }],
            positions: {
              mobile: { x: 16, y: 310 },
              tablet: { x: 560, y: 220 },
              desktop: { x: 640, y: 220 },
            },
          },
          {
            id: 'zendesk1',
            name: 'Zendesk',
            color: '#03363D',
            icon: <BookIcon className='h-4 w-4' />,
            positions: {
              mobile: { x: 16, y: 400 },
              tablet: { x: 820, y: 120 },
              desktop: { x: 920, y: 120 },
            },
          },
          {
            id: 'zendesk2',
            name: 'Zendesk',
            color: '#03363D',
            icon: <BookIcon className='h-4 w-4' />,
            tags: [{ icon: <BookIcon className='h-3 w-3' />, label: 'Draft Reply' }],
            positions: {
              mobile: { x: 16, y: 490 },
              tablet: { x: 820, y: 220 },
              desktop: { x: 920, y: 220 },
            },
          },
          {
            id: 'slack',
            name: 'Slack',
            color: '#36C5F0',
            icon: <SlackIcon className='h-4 w-4' />,
            positions: {
              mobile: { x: 16, y: 580 },
              tablet: { x: 1080, y: 160 },
              desktop: { x: 1200, y: 160 },
            },
          },
        ],
        edges: [
          { id: 'a', from: 'start', to: 'stripe' },
          { id: 'b', from: 'stripe', to: 'gmail1' },
          { id: 'c', from: 'stripe', to: 'gmail2' },
          { id: 'd', from: 'gmail1', to: 'zendesk1' },
          { id: 'e', from: 'gmail2', to: 'zendesk2' },
          { id: 'f', from: 'zendesk1', to: 'slack' },
          { id: 'g', from: 'zendesk2', to: 'slack' },
        ],
        groupGrid: { colStart: 2, colEnd: 4, rowStart: 0, rowEnd: 1, labels: ['Loop', 'For Each'] },
      },
    ]

    const typeText = (targetLength: number, text: string, secondsPerChar = 0.045) => {
      const duration = Math.max(1.1, targetLength * secondsPerChar)
      const proxy = { p: 0 }
      return gsap.to(proxy, {
        p: 1,
        duration,
        ease: 'none',
        onUpdate: () => {
          const len = Math.round(proxy.p * targetLength)
          setPrompt(text.slice(0, len))
        },
      })
    }

    // Smooth exit animations: run at play time (not build time)
    const runHideEdgesAndGroup = () => {
      const root = flowWrapRef.current
      const edgePaths = root ? Array.from(root.querySelectorAll<SVGPathElement>('.react-flow__edge-path')) : []
      if (edgePaths.length > 0) {
        gsap.to(edgePaths, { opacity: 0, duration: 0.3, ease: 'power2.in' })
      }
    }

    const runHideBlocks = () => {
      const root = flowWrapRef.current
      // Animate inner content so we don't fight React Flow transforms
      const nodeInners = root ? Array.from(root.querySelectorAll<HTMLElement>('.landing-node .landing-node-inner')) : []
      if (nodeInners.length > 0) {
        const ordered = [...nodeInners].sort((a, b) => {
          const ra = a.getBoundingClientRect()
          const rb = b.getBoundingClientRect()
          if (ra.left !== rb.left) return ra.left - rb.left
          return ra.top - rb.top
        })
        gsap.to(ordered, {
          y: 8,
          scale: 0.98,
          opacity: 0,
          duration: 0.35,
          ease: 'power2.in',
          stagger: 0.06,
        })
      } else if (root) {
        gsap.to(root, { opacity: 0, y: 8, scale: 0.98, duration: 0.35, ease: 'power2.in' })
      }
    }

    // --- Layout helpers (manual responsive positions) ---------------------
    function getCurrentBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
      if (typeof window === 'undefined') return 'desktop'
      const w = window.innerWidth
      if (w < 640) return 'mobile'
      if (w < 1024) return 'tablet'
      return 'desktop'
    }

    function computeLayout(base: WorkflowManualBlock[], _groupGrid?: GridPrompt['groupGrid']) {
      const pad = 16
      const bp = getCurrentBreakpoint()
      const nodes: WorkflowBlockNode[] = base.map((b) => {
        const pos = b.positions[bp]
        const nx = Math.max(pad, pos.x)
        const ny = Math.max(pad, pos.y)
        return { id: b.id, x: nx, y: ny, name: b.name, color: b.color, icon: b.icon, tags: b.tags }
      })
      const maxRight = nodes.reduce((m, n) => Math.max(m, n.x), 0)
      const worldW = maxRight + CARD_WIDTH + pad
      const groupPx: WorkflowGroupData | null = null
      return { nodes, worldW, groupPx }
    }

    // Camera panning helpers
    // React Flow will handle panning via setViewport; we'll trigger it using a helper
    function panRightIfOverflow() {
      if (!previewRef.current) return
      const overflow = Math.max(0, worldWidth - previewRef.current.clientWidth)
      if (overflow > 12) {
        // Pan will be handled inside LandingFlow with a delay
      }
    }

    function panReset() {
      const api = viewportApiRef.current
      if (api) {
        api.panTo(0, 0, { duration: 0 })
      }
    }

    const panBackNow = () => {
      const api = viewportApiRef.current
      if (!api) return
      const current = api.getViewport()
      if (!current) return
      const proxy = { x: current.x, y: current.y }
      gsap.to(proxy, {
        x: 0,
        y: 0,
        duration: 0.45,
        ease: 'power2.inOut',
        onUpdate: () => api.panTo(proxy.x, proxy.y, { duration: 0 }),
      })
    }

    // Textarea height animation helpers (single-state: isCondensed)
    // ---- Textarea expand/collapse: simple, robust, single-state ----
    function getBaseMinHeightPx() {
      return window.innerWidth >= 640 ? 112 : 96
    }

    // Use outer ensureTextareaAutosize directly

    function animateWrapperHeight(targetPx: number) {
      const wrap = textareaWrapRef.current
      if (!wrap) return
      const current = wrap.getBoundingClientRect().height
      // If no change, skip
      if (Math.abs(current - targetPx) < 1) return
      // Lock current height and animate to target
      wrap.style.height = `${current}px`
      wrap.style.overflow = 'hidden'
      wrap.style.willChange = 'height'
        wrap.style.transition = `height ${EXPAND_MS}ms ease-in-out`
      // Force a reflow to ensure the following height change animates
      void wrap.getBoundingClientRect().height
      requestAnimationFrame(() => {
        wrap.style.height = `${targetPx}px`
      })
      const cleanup = () => {
        wrap.style.removeProperty('height')
        wrap.style.removeProperty('overflow')
        wrap.style.removeProperty('will-change')
        wrap.style.removeProperty('transition')
        wrap.removeEventListener('transitionend', cleanup)
      }
      wrap.addEventListener('transitionend', cleanup, { once: true })
      // Fallback cleanup (in case transitionend is missed)
      window.setTimeout(cleanup, 900)
    }

    function collapseToContent() {
      const wrap = textareaWrapRef.current
      const ta = textareaRef.current
      if (wrap && ta) {
        const wrapStart = wrap.getBoundingClientRect().height
        const targetH = computeTextareaContentHeight()
        // Prepare wrapper animation
        wrap.style.height = `${wrapStart}px`
        wrap.style.overflow = 'hidden'
        wrap.style.willChange = 'height'
        wrap.style.transition = `height ${COLLAPSE_MS}ms ease-in-out`
        // Toggle state before animating
        setIsCondensed(true)
        // Animate textarea and wrapper heights in sync
        void wrap.getBoundingClientRect().height
        requestAnimationFrame(() => {
          animateTextareaHeightTo(targetH, COLLAPSE_MS, 'ease-in-out')
          wrap.style.height = `${targetH}px`
        })
        const cleanup = () => {
          wrap.style.removeProperty('height')
          wrap.style.removeProperty('overflow')
          wrap.style.removeProperty('will-change')
          wrap.style.removeProperty('transition')
          wrap.removeEventListener('transitionend', cleanup)
        }
        wrap.addEventListener('transitionend', cleanup, { once: true })
        window.setTimeout(cleanup, COLLAPSE_MS + 120)
      } else {
        setIsCondensed(true)
        ensureTextareaAutosize()
      }
    }

    function expandToMin() {
      const target = getBaseMinHeightPx()
      const wrap = textareaWrapRef.current
      if (wrap) {
        wrap.style.height = `${wrap.getBoundingClientRect().height}px`
        wrap.style.overflow = 'hidden'
        wrap.style.willChange = 'height'
        wrap.style.transition = `height ${EXPAND_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
        setIsCondensed(false)
        void wrap.getBoundingClientRect().height
        requestAnimationFrame(() => {
          wrap.style.height = `${target}px`
        })
        const cleanup = () => {
          wrap.style.removeProperty('height')
          wrap.style.removeProperty('overflow')
          wrap.style.removeProperty('will-change')
          wrap.style.removeProperty('transition')
          wrap.removeEventListener('transitionend', cleanup)
        }
        wrap.addEventListener('transitionend', cleanup, { once: true })
        window.setTimeout(cleanup, EXPAND_MS + 100)
      } else {
        setIsCondensed(false)
      }
      // Reset textarea inline height so min-height controls size again
      const ta = textareaRef.current
      if (ta) ta.style.removeProperty('height')
    }

    // Control chip and send button visibility
    function hideControls() {
      if (sendBtnRef.current) gsap.to(sendBtnRef.current, { autoAlpha: 0, scale: 0.9, duration: 0.2, ease: 'power2.out' })
      if (modeTagRef.current) gsap.to(modeTagRef.current, { autoAlpha: 0, scale: 0.95, duration: 0.2, ease: 'power2.out' })
    }
    function showControls() {
      if (sendBtnRef.current) gsap.to(sendBtnRef.current, { autoAlpha: 1, scale: 1, duration: 0.25, ease: 'power2.out' })
      if (modeTagRef.current) gsap.to(modeTagRef.current, { autoAlpha: 1, scale: 1, duration: 0.25, ease: 'power2.out' })
    }

    const startPulse = () => {
      if (!textareaWrapRef.current) return
      pulseRef.current?.kill()
      pulseRef.current = gsap.to(textareaWrapRef.current, {
        boxShadow: '0 0 0 2px rgba(164,111,255,0.45), 0 0 0 6px rgba(164,111,255,0.15)',
        duration: 0.6,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
      })
    }

    const stopPulse = () => {
      pulseRef.current?.kill()
      pulseRef.current = null
      if (textareaWrapRef.current) gsap.set(textareaWrapRef.current, { boxShadow: 'none' })
    }

    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } })
    tlRef.current = tl


    PROMPTS.forEach((entry, idx) => {
      const text = entry.text

      tl.addLabel(`prompt-${idx}-start`)
        .call(() => {
          setPrompt('')
          setIsRunning(false)
          // Ensure typing stage uses roomy min-height
          setIsCondensed(false)
          if (sendBtnRef.current) gsap.set(sendBtnRef.current, { autoAlpha: 1, scale: 1 })
          if (modeTagRef.current) gsap.set(modeTagRef.current, { autoAlpha: 1, scale: 1 })
          // Hide workflow preview while typing so it doesn't show early
          if (flowWrapRef.current) gsap.set(flowWrapRef.current, { autoAlpha: 0 })
        })
        .add(typeText(text.length, text), '+=0')
        // Show controls collapse but begin workflow preview immediately
        .add(() => { hideControls(); collapseToContent() })
        .call(() => {
          setIsRunning(true)
          startPulse()
          const layout = computeLayout(entry.blocks as unknown as WorkflowManualBlock[], entry.groupGrid)
          setWorldWidth(layout.worldW)
          // Order nodes left-to-right then top-to-bottom for stagger
          const ordered = [...layout.nodes].sort((a, b) => (a.x - b.x) || (a.y - b.y))
          const idToDelay = new Map<string, number>()
          ordered.forEach((n, i) => idToDelay.set(n.id, i * 0.18))
          // Transform to React Flow nodes/edges
          const newNodes: Node[] = layout.nodes.map((b) => ({
            id: b.id,
            type: 'landing',
            position: { x: b.x, y: b.y },
            data: { icon: b.icon, color: b.color, name: b.name, tags: b.tags, delay: idToDelay.get(b.id) ?? 0 },
            draggable: false,
            selectable: false,
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
          }))
          const newEdges: Edge[] = entry.edges.map((e, i) => ({
            id: e.id,
            source: e.from,
            target: e.to,
            type: 'landingEdge',
            animated: true,
            data: { delay: (idToDelay.get(e.from) ?? 0) + 0.15 },
            style: { strokeDasharray: '6 6', strokeWidth: 2, stroke: '#E1E1E1', opacity: 0 },
          }))
          setRfNodes(newNodes)
          setRfEdges(newEdges)
          setGroupBox(layout.groupPx)
          // Fade workflow into view now that nodes are ready
          if (flowWrapRef.current) gsap.to(flowWrapRef.current, { autoAlpha: 1, duration: 0.3, ease: 'power2.out' })
        })
        .to({}, { duration: COLLAPSE_MS / 1000 })

      const ctw = undefined
      if (ctw) tl.add(ctw)

      tl.to({}, { duration: 0.02 })
        .call(() => panRightIfOverflow(), undefined, '+=0.05')
        .to({}, { duration: 7.0 })
        // Pan back so exit animation happens in view
        .call(panBackNow)
        .to({}, { duration: 0.45 })
        .call(() => {
          setIsRunning(false)
          stopPulse()
        })
        // Keep nodes visible between cycles to avoid blank states
        .call(() => {
          setPrompt('')
          // Back to expanded for next prompt
          expandToMin()
          showControls()
          if (flowWrapRef.current) gsap.set(flowWrapRef.current, { clearProps: 'opacity,transform' })
        })
        .to({}, { duration: 0.05 })
        .call(panReset)

      const etw = undefined
      if (etw) tl.add(etw)

      tl.to([sendBtnRef.current, modeTagRef.current], { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'power2.out' })
    })

    tl.repeat(-1).repeatDelay(1.0)

    return () => {
      tl.kill()
      pulseRef.current?.kill()
      pulseRef.current = null
      if (textareaWrapRef.current) gsap.set(textareaWrapRef.current, { clearProps: 'height' })
    }
  }, [autoPlay])

  // While condensed, auto-resize textarea and animate wrapper height as content changes
  React.useEffect(() => {
    if (!isCondensed) return
    const wrap = textareaWrapRef.current
    if (!wrap) return
    const currentH = wrap.getBoundingClientRect().height
    const targetH = computeTextareaContentHeight()
    // If height changed due to typing, animate smoothly
    if (Math.abs(currentH - targetH) > 1) {
      wrap.style.height = `${currentH}px`
      wrap.style.overflow = 'hidden'
      wrap.style.willChange = 'height'
      wrap.style.transition = 'height 250ms ease'
      void wrap.getBoundingClientRect().height
      requestAnimationFrame(() => {
        animateTextareaHeightTo(targetH, 250, 'ease')
        wrap.style.height = `${targetH}px`
      })
      const cleanup = () => {
        wrap.style.removeProperty('height')
        wrap.style.removeProperty('overflow')
        wrap.style.removeProperty('will-change')
        wrap.style.removeProperty('transition')
        wrap.removeEventListener('transitionend', cleanup)
      }
      wrap.addEventListener('transitionend', cleanup, { once: true })
      window.setTimeout(cleanup, 600)
    }
  }, [prompt, isCondensed])

  // Track mobile viewport for responsive textarea rows
  React.useEffect(() => {
    const updateIsMobile = () => setIsMobile(typeof window !== 'undefined' ? window.innerWidth < 640 : false)
    updateIsMobile()
    if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
    return () => { if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile) }
  }, [])

  return (
    <div className="[background-image:url('/static/bg.png')] bg-cover bg-center relative w-full flex flex-col items-center  overflow-hidden min-h-[calc(100vh-6rem)] px-4 sm:px-8 md:px-12 lg:px-20 xl:px-32 pt-32 sm:pt-48 lg:pt-52">
      <div className="flex flex-col items-center w-full max-w-6xl gap-12 lg:gap-16 z-10">
        <div className='flex flex-col gap-4 items-center text-center'>
          <h1 className='text-5xl lg:text-6xl font-inter font-medium text-foreground tracking-[-0.04em] leading-tight'>
            Workflows for <span className='bg-gradient-to-b from-[#6F3DFA] via-[#F05391] to-[#9664EB] bg-clip-text text-transparent'>LLMs</span>
          </h1>
          <p className='text-base sm:text-lg md:text-xl leading-6 text-[#484848]'>
            Build and deploy AI agent workflows
          </p>
        </div>
        {/* CHAT WITH AUTOPLAY */}
        <div className='chat w-full md:w-auto flex flex-col items-center gap-2'>
          <div className="hidden px-4 md:flex gap-2">
            {AGENT_OPTIONS.map((agent) => (
              <Link href={'/signup'} key={agent.value} target="_blank" rel="noopener noreferrer">
                <div className="flex items-center gap-2 rounded-[8px] border border-border bg-background px-2 py-1.5 shadow-xs transition-all hover:scale-105">
                  <agent.icon className='h-4 w-4' />
                  <span className='text-sm'>{agent.label}</span>
                </div>
              </Link>
            ))}
          </div>
          <div ref={textareaWrapRef} className={`relative block w-full overflow-hidden rounded-[10px] ${isCondensed ? 'h-fit' : ''}`}>
            {/* Visual input */}
            <Textarea
              placeholder="Ask me to create a voice agent..."
              ref={textareaRef}
              onFocus={stopAuto}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              rows={isMobile ? 2 : 1}
              className={`!block !align-middle overflow-hidden px-4 pr-16 py-3 !text-base md:!text-base leading-[1.25] border-input rounded-[10px] shadow-sm resize-none placeholder:!text-base placeholder:leading-[1.25] placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-[#A46FFF] focus-visible:ring-offset-0 focus-visible:border-[#A46FFF] focus-visible:outline-none ${isCondensed ? '!min-h-0' : '!min-h-[7rem]'}`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {/* Hidden sizer mirrors the text with identical typography to get exact content height without textarea quirks */}
            <div
              aria-hidden
              ref={textareaSizerRef}
              className="pointer-events-none absolute left-0 top-0 w-full invisible whitespace-pre-wrap break-words px-4 pr-16 py-4 text-base md:text-base leading-[1.25]"
            >
              {prompt || ' '}
            </div>
            <Button
              variant='default'
              size='icon'
              onClick={handleSend}
              ref={sendBtnRef}
              className="absolute right-3 bottom-3 rounded-full border border-[#AC7CFF] bg-gradient-to-b from-[#8A47FF] to-[#6F3DFA] text-white shadow-sm"
            >
              <ArrowUp className='h-4 w-4' />
            </Button>
          <div className="absolute left-3 bottom-3 flex items-center">
            <div ref={modeTagRef} className='flex items-center gap-1 rounded-full bg-secondary px-2 py-1'>
              {MODES.find((m) => m.value === mode)?.icon}
              <p className='text-sm leading-normal text-foreground'>{mode.charAt(0).toUpperCase() + mode.slice(1)}</p>
              <ChevronDownIcon className='h-3 w-3 text-muted-foreground' />
            </div>
          </div>
          </div>
        </div>
        {/* WORKFLOW PREVIEW USING REACT FLOW */}
        <div ref={previewRef} className='preview mt-4 relative w-full h-[36rem] overflow-hidden bg-background/80 shadow-sm border-t border-x border-border rounded-t-[10px] flex'>
          <DotPattern className='absolute top-0 left-0 w-full h-full opacity-20 z-0 pointer-events-none' />
          <div ref={flowWrapRef} className='relative z-10 w-full h-full'>
            <ReactFlowProvider>
              <LandingFlow
                nodes={rfNodes}
                edges={rfEdges}
                groupBox={groupBox}
                worldWidth={worldWidth}
                wrapperRef={flowWrapRef}
                viewportApiRef={viewportApiRef}
              />
            </ReactFlowProvider>
          </div>
        </div>
      </div>
    </div>
  )
}

type WorkflowBlockProps = {
  icon: React.ReactNode,
  color: string | '#f6f6f6',
  name: string
  tags?: TagProps[]
  className?: string
}

type TagProps = {
  icon: React.ReactNode,
  label: string
}

const Tag = React.memo(function Tag({ icon, label }: TagProps) {
  return (
    <div className='flex items-center gap-1 px-2 py-0.5 bg-secondary rounded-[8px] w-fit'>
      <div className='text-muted-foreground w-3 h-3'>
        {icon}
      </div>
      <p className='text-xs leading-normal text-muted-foreground'>{label}</p>
    </div>
  )
})

const WorkflowBlock = React.memo(function WorkflowBlock({ icon, color, name, tags, className }: WorkflowBlockProps) {
  return (
    <div className={`z-10 w-64 h-fit flex flex-col gap-4 p-3 bg-card rounded-[14px] border-border border shadow-xs ${className ?? ''}`}>
      <div className='flex justify-between items-center'>
        <div className='flex items-center gap-2.5'>
          <div className='flex items-center justify-center rounded-[8px] w-6 h-6 text-white' style={{ backgroundColor: color as string }}>
            {icon}
          </div>
          <p className='text-base font-medium text-card-foreground'>{name}</p>
        </div>
        <div className='flex gap-4 items-center'>
          <BookIcon className='h-4 w-4 text-muted-foreground' />
          <ChevronUpIcon className='h-4 w-4 text-muted-foreground' />
        </div>
      </div>

      {tags && tags.length > 0 ? (
        <div className='flex flex-wrap gap-2'>
          {tags.map((tag) => (
            <Tag key={tag.label} icon={tag.icon} label={tag.label} />
          ))}
        </div>
      ) : null}
    </div>
  )
})

// React Flow node components
const LandingNode = React.memo(function LandingNode({ data }: { data: WorkflowCardData }) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const innerRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!innerRef.current) return
    const el = innerRef.current
    // Ensure hidden on mount to avoid any flash before GSAP runs
    el.style.opacity = '0'
    el.style.transform = 'translateY(8px) scale(0.98)'
    const delay = (data as any)?.delay ?? 0
    const dc = gsap.delayedCall(delay, () => {
      gsap.to(el, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.6,
        ease: 'power3.out',
      })
    })
    return () => { dc.kill() }
  }, [data])

  return (
    <div ref={wrapperRef} className='relative landing-node'>
      <Handle
        type='target'
        position={Position.Left}
        style={{ opacity: 0, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        isConnectable={false}
      />
      <Handle
        type='source'
        position={Position.Right}
        style={{ opacity: 0, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        isConnectable={false}
      />
      <div
        ref={innerRef}
        className='landing-node-inner'
        style={{ opacity: 0, transform: 'translateY(8px)  scale(0.98)', willChange: 'transform, opacity' }}
      >
        <WorkflowBlock icon={data.icon} color={data.color} name={data.name} tags={data.tags} />
      </div>
    </div>
  )
})

// Custom edge that fades/animates in like blocks
const LandingEdge = React.memo(function LandingEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data } = props

  const [edgeStyle, setEdgeStyle] = React.useState<React.CSSProperties | undefined>(style)

  React.useEffect(() => {
    const delay = (data as any)?.delay ?? 0
    const dc = gsap.delayedCall(Math.max(0, delay), () => {
      setEdgeStyle((prev) => ({ ...(prev || {}), opacity: 1 }))
    })
    return () => { dc.kill() }
  }, [data])

  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
    offset: 16,
  })

  return <BaseEdge id={id} path={path} style={{ strokeLinecap: 'round', strokeLinejoin: 'round', filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.08))', ...edgeStyle }} />
})

type LandingFlowProps = {
  nodes: Node[]
  edges: Edge[]
  groupBox: WorkflowGroupData | null
  worldWidth: number
  wrapperRef: React.RefObject<HTMLDivElement | null>
  viewportApiRef: React.MutableRefObject<LandingViewportApi | null>
}

function LandingFlow({ nodes, edges, groupBox, worldWidth, wrapperRef, viewportApiRef }: LandingFlowProps) {
  const { setViewport, getViewport } = useReactFlow()
  const [rfReady, setRfReady] = React.useState(false)

  // Node and edge types map
  const nodeTypes = React.useMemo(() => ({ landing: LandingNode }), [])
  const edgeTypes = React.useMemo(() => ({ landingEdge: LandingEdge }), [])

  // Compose nodes with optional group overlay
  const flowNodes = nodes

  // Auto-pan to the right only if content overflows the wrapper
  React.useEffect(() => {
    const el = wrapperRef.current as HTMLDivElement | null
    if (!el || !rfReady || nodes.length === 0) return
    const containerWidth = el.clientWidth
    // Derive overflow from actual node positions for accuracy
    const CARD_W = 256
    const PAD = 16
    const maxRight = nodes.reduce((m, n) => Math.max(m, (n.position?.x ?? 0) + CARD_W), 0)
    const contentWidth = Math.max(worldWidth, maxRight + PAD)
    const overflow = Math.max(0, contentWidth - containerWidth)

    // Delay pan so initial nodes are visible briefly
    const timer = window.setTimeout(() => {
      if (overflow > 12) {
        setViewport({ x: -overflow, y: 0, zoom: 1 }, { duration: 900 })
      }
    }, 1400)

    return () => window.clearTimeout(timer)
  }, [worldWidth, wrapperRef, setViewport, rfReady, nodes])

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: 'smoothstep' }}
      elementsSelectable={false}
      nodesDraggable={false}
        nodesConnectable={false}
      zoomOnScroll={false}
      panOnScroll={false}
      zoomOnPinch={false}
      panOnDrag={false}
      proOptions={{ hideAttribution: true }}
      fitView={false}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      onInit={(instance) => {
        setRfReady(true)
        // Expose limited viewport API for outer timeline to pan smoothly
        viewportApiRef.current = {
          panTo: (x: number, y: number, options?: { duration?: number }) => {
            setViewport({ x, y, zoom: 1 }, { duration: options?.duration ?? 0 })
          },
          getViewport: () => getViewport(),
        }
      }}
      className='w-full h-full pointer-events-none'
    >
      {null}
    </ReactFlow>
  )
}

// Minimal search icon for a tag without adding new deps
function SearchIconMini() {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      className='h-4 w-4'
    >
      <circle cx='11' cy='11' r='7' />
      <line x1='21' y1='21' x2='16.65' y2='16.65' />
    </svg>
  )
}

type WorkflowCardData = {
  icon: React.ReactNode
  color: string | '#f6f6f6'
  name: string
  tags?: TagProps[]
}

type WorkflowBlockNode = WorkflowCardData & {
  id: string
  x: number
  y: number
}

type WorkflowEdgeData = {
  id: string
  from: string
  to: string
}

type WorkflowGroupData = {
  x: number
  y: number
  w: number
  h: number
  labels: string[]
}

// Manual responsive positions for clean layouts
type WorkflowManualBlock = Omit<WorkflowCardData, 'x' | 'y'> & {
  id: string
  positions: {
    mobile: { x: number; y: number }
    tablet: { x: number; y: number }
    desktop: { x: number; y: number }
  }
}

type GridPrompt = {
  text: string
  blocks: WorkflowManualBlock[]
  edges: WorkflowEdgeData[]
  groupGrid?: { colStart: number; colEnd: number; rowStart: number; rowEnd: number; labels: string[] }
}

export default Hero
