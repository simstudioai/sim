'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

interface MermaidDiagramProps {
  chart: string
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, '-')
  const containerId = `mermaid-${id}`
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const rendered = useRef(false)

  const renderDiagram = useCallback(async () => {
    if (rendered.current) return
    rendered.current = true

    try {
      const mermaid = (await import('mermaid')).default

      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        fontFamily: 'var(--font-martian-mono), ui-monospace, monospace',
        fontSize: 13,
        themeVariables: {
          // Background
          mainBkg: '#232323',
          secondBkg: '#1C1C1C',
          tertiaryColor: '#2A2A2A',

          // Text
          primaryTextColor: '#ECECEC',
          secondaryTextColor: '#999999',
          tertiaryTextColor: '#666666',

          // Lines and borders
          lineColor: '#3d3d3d',
          primaryBorderColor: '#2A2A2A',
          secondaryBorderColor: '#3d3d3d',

          // Nodes
          nodeBorder: '#3d3d3d',
          clusterBorder: '#2A2A2A',
          clusterBkg: '#1C1C1C',

          // Brand accent colors for different node types
          primaryColor: '#232323',
          secondaryColor: '#1C1C1C',

          // Flowchart-specific
          edgeLabelBackground: '#1C1C1C',

          // Notes
          noteBkgColor: '#232323',
          noteTextColor: '#ECECEC',
          noteBorderColor: '#2A2A2A',

          // Sequence diagram
          actorBkg: '#232323',
          actorTextColor: '#ECECEC',
          actorBorder: '#3d3d3d',
          activationBorderColor: '#2ABBF8',
          activationBkgColor: '#232323',
          signalColor: '#ECECEC',
          signalTextColor: '#ECECEC',
          labelBoxBkgColor: '#232323',
          labelBoxBorderColor: '#2A2A2A',
          labelTextColor: '#ECECEC',
          loopTextColor: '#999999',
        },
      })

      const { svg: renderedSvg } = await mermaid.render(containerId, chart.trim())
      setSvg(renderedSvg)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render diagram')
    }
  }, [chart, containerId])

  useEffect(() => {
    renderDiagram()
  }, [renderDiagram])

  if (error) {
    return (
      <div
        className='my-8 overflow-hidden border border-[#2A2A2A] bg-[#111111]'
        style={{ borderRadius: '2px' }}
      >
        <div className='flex items-center justify-between border-[#2A2A2A] border-b bg-[#232323] px-4 py-2'>
          <div className='flex items-center gap-2'>
            <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
            <span className='inline-block h-2 w-2 bg-[#2ABBF8]' aria-hidden='true' />
            <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
          </div>
          <span className='font-mono text-[#ECECEC] text-[10px] uppercase tracking-widest'>
            Mermaid
          </span>
          <span />
        </div>
        <pre className='overflow-x-auto p-4 font-mono text-[#d4d4d8] text-[13px] leading-relaxed'>
          {chart}
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className='my-8 flex items-center justify-center border border-[#2A2A2A] bg-[#1C1C1C] py-12'
        style={{ borderRadius: '2px' }}
      >
        <div className='flex items-center gap-3 font-mono text-[#666] text-[11px] uppercase tracking-widest'>
          <span className='inline-block h-2 w-2 animate-pulse bg-[#2ABBF8]' />
          Rendering diagram...
        </div>
      </div>
    )
  }

  return (
    <div
      className='my-8 overflow-hidden border border-[#2A2A2A] bg-[#1C1C1C]'
      style={{ borderRadius: '2px' }}
    >
      <div className='flex items-center justify-between border-[#2A2A2A] border-b bg-[#232323] px-4 py-2'>
        <div className='flex items-center gap-2'>
          <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
          <span className='inline-block h-2 w-2 bg-[#2ABBF8]' aria-hidden='true' />
          <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
        </div>
        <span className='font-mono text-[#ECECEC] text-[10px] uppercase tracking-widest'>
          Diagram
        </span>
        <span />
      </div>
      <div
        ref={containerRef}
        className='flex items-center justify-center overflow-x-auto p-6 [&_svg]:max-w-full'
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}
