'use client'

import { type ReactNode, useState } from 'react'
import { BarChart, DonutChart, TrendChart } from '@sim/emcn/chart/charts'
import { MetricGroup } from '@sim/emcn/data-display'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import {
  formatUnit,
  niceMaximum,
} from '@/app/(product)/_components/workspace/workspace-session/format'
import type {
  DashboardContent,
  DashboardSection,
} from '@/app/(product)/_components/workspace/workspace-session/model'
import { DashboardTable } from '@/app/(product)/workspace/[workspaceId]/_components/dashboard-table/dashboard-table'
import { AgentRoster } from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/agent-roster/agent-roster'
import styles from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/dashboard-section/dashboard-section.module.css'
import { GroupedBars } from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/grouped-bars/grouped-bars'
import { SignedBars } from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/signed-bars/signed-bars'

interface SectionFrameProps {
  title: string
  control?: ReactNode
  children: ReactNode
}

/** The same title row the shared charts draw: a section control adds no height to it. */
function SectionFrame({ title, control, children }: SectionFrameProps) {
  return (
    <section className={styles.section} aria-label={title}>
      <header className={styles.heading}>
        <h2 data-type='T042'>{title}</h2>
        {control && <span className={styles.control}>{control}</span>}
      </header>
      {children}
    </section>
  )
}

function SectionBody({ title, content }: { title: string; content: DashboardContent }) {
  switch (content.kind) {
    case 'metrics':
      return (
        <MetricGroup
          metrics={content.metrics.map((metric) => ({
            label: metric.label,
            value: formatUnit(metric.value, metric.unit),
          }))}
        />
      )
    case 'text':
      return (
        <div className={styles.text}>
          {content.paragraphs.map((paragraph, index) => (
            <p key={index} data-type='T048'>
              {paragraph}
            </p>
          ))}
        </div>
      )
    case 'roster':
      return <AgentRoster label={title} agents={content.agents} />
    case 'table':
      return <DashboardTable label={title} columns={content.columns} rows={content.rows} />
    case 'signed':
      return <SignedBars label={title} unit={content.unit} rows={content.rows} />
    case 'bars':
      return content.layout === 'grouped' ? (
        <GroupedBars
          label={title}
          unit={content.unit}
          series={content.series}
          bars={content.bars}
        />
      ) : null
    default:
      return null
  }
}

interface DashboardSectionViewProps {
  section: DashboardSection
}

/**
 * One dashboard section. Its own choice, such as an agent or a breakdown, changes only this
 * section's content and survives a change of period.
 */
export function DashboardSectionView({ section }: DashboardSectionViewProps) {
  const options = section.choice?.options ?? []
  const [choice, setChoice] = useState(options[0]?.value ?? 'default')
  const content = section.views[choice] ?? Object.values(section.views)[0]
  if (!content) return null
  const control = section.choice && (
    <ChoiceMenu
      label={section.choice.label}
      options={options}
      value={choice}
      onValueChange={setChoice}
    />
  )
  if (content.kind === 'trend')
    return (
      <TrendChart
        title={section.title}
        control={control}
        points={content.points}
        maximum={niceMaximum(Math.max(0, ...content.points.map((point) => point.value)))}
      />
    )
  if (content.kind === 'donut')
    return (
      <DonutChart
        title={section.title}
        control={control}
        segments={content.segments}
        totalLabel={content.totalLabel}
      />
    )
  if (content.kind === 'bars' && content.layout === 'stacked')
    return (
      <BarChart
        title={section.title}
        control={control}
        series={content.series}
        bars={content.bars}
        maximum={niceMaximum(
          Math.max(
            0,
            ...content.bars.map((bar) => bar.values.reduce((sum, value) => sum + value, 0))
          )
        )}
      />
    )
  return (
    <SectionFrame title={section.title} control={control}>
      <SectionBody title={section.title} content={content} />
    </SectionFrame>
  )
}
