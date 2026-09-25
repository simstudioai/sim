'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { EChartsType } from 'echarts'
import { useTheme } from 'next-themes'
import { chartSummaryExtension } from '@/lib/charts/summary'
import { applyChartTooltipDefaults, readEmcnChartTheme } from '@/lib/charts/theme'

interface EChartsViewProps {
  option: Record<string, unknown>
  label: string
  className?: string
  createController?: (chart: EChartsType) => EChartsController
  revision?: string
}

export interface EChartsController {
  prepareOption: (option: Record<string, unknown>) => Record<string, unknown>
  afterUpdate: () => void
  dispose: () => void
}

/**
 * Both chart documents and dashboards use this canvas lifecycle and EMCN theme.
 * Canvas tracking must match ECharts' detached measuring canvas, which has no CSS letter spacing.
 */
export function EChartsView({
  option,
  label,
  className,
  createController,
  revision,
}: EChartsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const controllerRef = useRef<EChartsController | null>(null)
  const { resolvedTheme } = useTheme()
  const [status, setStatus] = useState<{ theme: string | undefined; error?: string } | null>(null)
  const optionKey = JSON.stringify(option)
  const applyOption = useEffectEvent((chart: EChartsType, nextOption: string) => {
    try {
      controllerRef.current?.dispose()
      controllerRef.current = null
      const controller = createController?.(chart)
      controllerRef.current = controller ?? null
      const parsed = applyChartTooltipDefaults(JSON.parse(nextOption))
      chart.setOption(controller ? controller.prepareOption(parsed) : parsed, { notMerge: true })
      controller?.afterUpdate()
      setStatus({ theme: resolvedTheme })
    } catch (error) {
      controllerRef.current?.dispose()
      controllerRef.current = null
      setStatus({ theme: resolvedTheme, error: getErrorMessage(error, 'Unable to render chart') })
    }
  })
  const onChartReady = useEffectEvent((chart: EChartsType) => applyOption(chart, optionKey))

  useEffect(() => {
    let active = true
    let dispose: (() => void) | undefined
    const element = containerRef.current
    if (!element) return
    const font = getComputedStyle(element)
    Promise.all([
      import('echarts'),
      document.fonts.load(`${font.fontWeight} ${font.fontSize} ${font.fontFamily}`),
    ])
      .then(([echarts]) => {
        if (!active) return
        echarts.use(chartSummaryExtension)
        const chart = echarts.init(element, readEmcnChartTheme(element), { renderer: 'canvas' })
        dispose = () => chart.dispose()
        chartRef.current = chart
        const observer = new ResizeObserver(() => chart.resize())
        observer.observe(element)
        dispose = () => {
          observer.disconnect()
          chart.dispose()
        }
        onChartReady(chart)
      })
      .catch((error) => {
        if (active) {
          dispose?.()
          dispose = undefined
          chartRef.current = null
          setStatus({
            theme: resolvedTheme,
            error: getErrorMessage(error, 'Unable to render chart'),
          })
        }
      })
    return () => {
      active = false
      controllerRef.current?.dispose()
      controllerRef.current = null
      chartRef.current = null
      dispose?.()
    }
  }, [resolvedTheme])

  useEffect(() => {
    if (chartRef.current) applyOption(chartRef.current, optionKey)
  }, [optionKey, revision])

  const current = status?.theme === resolvedTheme ? status : null
  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        ref={containerRef}
        role='img'
        aria-label={label}
        className='h-full min-h-[220px] w-full [&_canvas]:tracking-normal'
      />
      {!current && (
        <div
          role='status'
          className='absolute inset-0 grid place-items-center bg-[var(--bg)] text-[var(--text-muted)] text-caption'
        >
          Loading chart…
        </div>
      )}
      {current?.error && (
        <div
          role='alert'
          className='absolute inset-0 overflow-auto bg-[var(--bg)] p-4 text-[var(--text-error)] text-caption'
        >
          {current.error}
        </div>
      )}
    </div>
  )
}
