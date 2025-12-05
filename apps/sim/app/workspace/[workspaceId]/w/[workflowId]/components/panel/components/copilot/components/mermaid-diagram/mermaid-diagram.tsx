'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ExternalLink } from 'lucide-react'
import mermaid from 'mermaid'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('MermaidDiagram')

interface MermaidDiagramProps {
  diagramText: string
}

/**
 * Renders mermaid diagrams with pan/zoom support
 */
export function MermaidDiagram({ diagramText }: MermaidDiagramProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.6)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const renderDiagram = useCallback(async () => {
    if (!diagramText?.trim()) {
      setError('No diagram text provided')
      return
    }

    try {
      setError(null)
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'loose',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 14,
        flowchart: {
          useMaxWidth: false,
          htmlLabels: true,
          padding: 20,
          nodeSpacing: 50,
          rankSpacing: 60,
        },
        themeVariables: {
          primaryColor: '#dbeafe',
          primaryTextColor: '#1e3a5f',
          primaryBorderColor: '#3b82f6',
          lineColor: '#64748b',
          secondaryColor: '#fef3c7',
          secondaryTextColor: '#92400e',
          secondaryBorderColor: '#f59e0b',
          tertiaryColor: '#d1fae5',
          tertiaryTextColor: '#065f46',
          tertiaryBorderColor: '#10b981',
          background: '#ffffff',
          mainBkg: '#dbeafe',
          nodeBorder: '#3b82f6',
          nodeTextColor: '#1e3a5f',
          clusterBkg: '#f1f5f9',
          clusterBorder: '#94a3b8',
          titleColor: '#0f172a',
          textColor: '#334155',
          edgeLabelBackground: '#ffffff',
        },
      })

      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      // Replace \n with <br> for proper line breaks in labels
      const processedText = diagramText.trim().replace(/\\n/g, '<br>')
      const { svg } = await mermaid.render(id, processedText)
      const encoded = btoa(unescape(encodeURIComponent(svg)))
      setDataUrl(`data:image/svg+xml;base64,${encoded}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to render diagram'
      logger.error('Mermaid render error', { error: msg })
      setError(msg)
    }
  }, [diagramText])

  useEffect(() => {
    renderDiagram()
  }, [renderDiagram])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((z) => Math.min(Math.max(z * delta, 0.1), 3))
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    },
    [pan]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      })
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  const openInNewTab = useCallback(() => {
    if (!dataUrl) return
    const html = `<!DOCTYPE html><html><head><title>Diagram</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f8fafc}img{max-width:95vw;max-height:95vh}</style></head><body><img src="${dataUrl}"></body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    window.open(URL.createObjectURL(blob), '_blank')
  }, [dataUrl])

  if (error) {
    return (
      <div className='flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-400 text-sm'>
        <AlertCircle className='h-4 w-4 flex-shrink-0' />
        <span>{error}</span>
      </div>
    )
  }

  if (!dataUrl) {
    return (
      <div className='flex h-24 items-center justify-center text-[var(--text-tertiary)] text-sm'>
        Rendering...
      </div>
    )
  }

  return (
    <div className='relative'>
      <button
        type='button'
        onClick={openInNewTab}
        className='absolute top-2 right-2 z-10 rounded bg-white/90 p-1.5 text-gray-600 shadow-sm transition-colors hover:bg-white hover:text-gray-900'
        title='Open in new tab'
      >
        <ExternalLink className='h-4 w-4' />
      </button>
      <div
        ref={containerRef}
        className='select-none overflow-hidden rounded-md border border-[var(--border-strong)] bg-white'
        style={{
          height: 500,
          minHeight: 150,
          resize: 'vertical',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        title='Scroll to zoom, drag to pan, drag edge to resize'
      >
        <img
          src={dataUrl}
          alt='Mermaid diagram'
          className='pointer-events-none h-full w-full object-contain'
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          draggable={false}
        />
      </div>
    </div>
  )
}
