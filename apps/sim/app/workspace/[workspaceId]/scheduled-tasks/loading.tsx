'use client'

import { Calendar, Plus } from '@/components/emcn'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'
import { useTranslations } from 'next-intl'

const ACTIONS: ChromeActionSpec[] = [{ text: 'New scheduled task', icon: Plus, variant: 'primary' }]

/**
 * Route-segment fallback: the page renders a calendar, not a table, so this
 * paints only the header chrome (no table columns / search / sort / filter).
 * The empty calendar then mounts and its tasks load in.
 */
export default function ScheduledTasksLoading() {
  const t = useTranslations('auto')
  return <ResourceChromeFallback icon={Calendar} title={t('scheduled_tasks')} actions={ACTIONS} />
}
