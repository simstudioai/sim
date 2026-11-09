'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { EChartsType } from 'echarts'
import styles from '@/components/file-viewer/chart-canvas.module.css'
import { tokenColors } from '@/components/file-viewer/resolve-colors'
import { useResolvedTheme } from '@/components/file-viewer/use-resolved-theme'
import { applyChartAnnotations, type ChartAnnotations } from '@/lib/charts/annotations'
import { installBarRowHighlight } from '@/lib/charts/bar-row-highlight'
import { CHART_BAR_MAX_WIDTH } from '@/lib/charts/option'
import { chartSummaryExtension } from '@/lib/charts/summary'
import { applyChartTooltipDefaults } from '@/lib/charts/theme'

const CHART_FONT_SIZE = 13

const THEME_TOKENS = [
  '--ui-ink',
  '--ui-secondary',
  '--ui-divider',
  '--ui-border',
  '--ui-reading',
  '--ui-plot-primary',
  '--ui-plot-secondary',
  '--ui-plot-violet-2',
  '--ui-plot-violet-4',
  '--control-danger',
  '--status-info',
] as const

type ThemeColors = Record<(typeof THEME_TOKENS)[number], string>

/** ECharts paints a canvas, which cannot read CSS variables, so the theme carries resolved tokens. */
function surfaceChartTheme(c: ThemeColors, fontFamily: string): Record<string, unknown> {
  const text = c['--ui-ink']
  const muted = c['--ui-secondary']
  const border = c['--ui-divider']
  const axis = {
    axisLine: { show: false, lineStyle: { color: border } },
    axisTick: { show: false },
    axisLabel: {
      color: muted,
      fontFamily,
      fontSize: CHART_FONT_SIZE,
      margin: 12,
      hideOverlap: true,
    },
    nameTextStyle: { color: muted, fontFamily, fontSize: CHART_FONT_SIZE },
    splitLine: { lineStyle: { color: border, width: 0.5, type: 'solid' } },
    splitNumber: 4,
  }
  return {
    color: [
      c['--ui-plot-primary'],
      c['--ui-plot-secondary'],
      c['--ui-plot-violet-2'],
      c['--ui-plot-violet-4'],
    ],
    backgroundColor: 'transparent',
    axisPointer: { shadowStyle: { color: text, opacity: 0.06 } },
    animationDuration: 0,
    textStyle: { fontFamily, fontSize: CHART_FONT_SIZE, color: text },
    title: {
      textStyle: { fontFamily, fontSize: CHART_FONT_SIZE, fontWeight: 'normal', color: text },
    },
    legend: {
      textStyle: { color: muted, fontFamily, fontSize: CHART_FONT_SIZE },
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
    },
    tooltip: {
      renderMode: 'richText',
      confine: true,
      backgroundColor: c['--ui-reading'],
      borderColor: c['--ui-border'],
      borderWidth: 1,
      padding: [6, 12],
      borderRadius: 6,
      shadowBlur: 0,
      textStyle: { fontFamily, color: text, fontSize: CHART_FONT_SIZE, fontWeight: 'normal' },
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
    timeAxis: { ...axis, splitLine: { show: false } },
    logAxis: axis,
    line: { symbolSize: 4, lineStyle: { width: 1.5 }, showSymbol: false },
    bar: {
      barMaxWidth: CHART_BAR_MAX_WIDTH,
      label: { fontFamily, fontSize: CHART_FONT_SIZE, color: text },
      itemStyle: { borderRadius: 2 },
    },
    pie: {
      label: { fontFamily, fontSize: CHART_FONT_SIZE, color: text, overflow: 'break' },
      itemStyle: { borderColor: c['--ui-reading'], borderWidth: 2 },
    },
  }
}

/** What an interactive chart adds around each option it is given, and removes on the next. */
export interface ChartController {
  prepareOption: (option: Record<string, unknown>) => Record<string, unknown>
  afterUpdate: () => void
  dispose: () => void
}

interface ChartCanvasProps {
  option: Record<string, unknown>
  label: string
  /** A fixed height in pixels, such as a horizontal bar chart's; otherwise the frame is 16:10. */
  height: number | null
  /** Highlights and thresholds, colored from the theme as the chart is drawn. */
  annotations?: ChartAnnotations
  createController?: (chart: EChartsType) => ChartController
  /** Re-applies the option when something the controller reads changes. */
  revision?: string
}

/**
 * One ECharts canvas in the surface's theme, for chart documents and dashboard panels: it is set
 * up once per theme and takes each new option in place, so an interactive chart keeps its state.
 */
export function ChartCanvas({
  option,
  label,
  height,
  annotations,
  createController,
  revision,
}: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const controllerRef = useRef<ChartController | null>(null)
  const unhighlightRef = useRef<(() => void) | null>(null)
  const colorsRef = useRef<ThemeColors | null>(null)
  const theme = useResolvedTheme()
  const [error, setError] = useState<string | null>(null)
  const optionKey = JSON.stringify({ option, annotations })

  const applyOption = useEffectEvent((chart: EChartsType, key: string) => {
    try {
      controllerRef.current?.dispose()
      controllerRef.current = createController?.(chart) ?? null
      const next: { option: Record<string, unknown>; annotations?: ChartAnnotations } =
        JSON.parse(key)
      const parsed = applyChartTooltipDefaults(next.option)
      const colors = colorsRef.current
      // Annotated after the bar helpers read the option: the label series reads as a non-bar chart.
      const rendered =
        next.annotations && colors
          ? applyChartAnnotations(parsed, next.annotations, {
              tones: {
                neutral: colors['--ui-secondary'],
                error: colors['--control-danger'],
                info: colors['--status-info'],
              },
            })
          : parsed
      const controller = controllerRef.current
      chart.setOption(controller ? controller.prepareOption(rendered) : rendered, {
        notMerge: true,
      })
      controller?.afterUpdate()
      unhighlightRef.current?.()
      unhighlightRef.current = installBarRowHighlight(chart, parsed)
      setError(null)
    } catch (failure) {
      controllerRef.current?.dispose()
      controllerRef.current = null
      setError(getErrorMessage(failure, 'Unable to render chart'))
    }
  })
  const onChartReady = useEffectEvent((chart: EChartsType) => applyOption(chart, optionKey))

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    element.style.height = height === null ? '' : `${height}px`
  }, [height])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let active = true
    let dispose: (() => void) | undefined
    void import('echarts')
      .then((echarts) => {
        if (!active) return
        echarts.use(chartSummaryExtension)
        const colors = tokenColors(element, THEME_TOKENS) as ThemeColors
        colorsRef.current = colors
        const chart = echarts.init(
          element,
          surfaceChartTheme(colors, getComputedStyle(element).fontFamily),
          { renderer: 'canvas' }
        )
        chartRef.current = chart
        const observer = new ResizeObserver(() => chart.resize())
        observer.observe(element)
        dispose = () => {
          observer.disconnect()
          chart.dispose()
        }
        onChartReady(chart)
      })
      .catch((failure) => {
        if (active) setError(getErrorMessage(failure, 'Unable to render chart'))
      })
    return () => {
      active = false
      unhighlightRef.current?.()
      unhighlightRef.current = null
      controllerRef.current?.dispose()
      controllerRef.current = null
      chartRef.current = null
      dispose?.()
    }
  }, [theme])

  useEffect(() => {
    if (chartRef.current) applyOption(chartRef.current, optionKey)
  }, [optionKey, revision])

  return (
    <div className={styles.frame} data-sized={height === null ? undefined : ''}>
      <div ref={containerRef} role='img' aria-label={label} className={styles.canvas} />
      {error && (
        <p className={styles.error} role='alert' data-type='T052'>
          {error}
        </p>
      )}
    </div>
  )
}
