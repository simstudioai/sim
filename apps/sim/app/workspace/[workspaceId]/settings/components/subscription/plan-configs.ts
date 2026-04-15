import {
  Clock,
  HardDrive,
  HeadphonesIcon,
  Server,
  ShieldCheck,
  Table2,
  Timer,
  Users,
  Zap,
} from 'lucide-react'
import { SlackMonoIcon } from '@/components/icons'
import type { PlanFeature } from '@/app/workspace/[workspaceId]/settings/components/subscription/components/plan-card'

export const PRO_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: '150 runs/min (sync)' },
  { icon: Clock, text: '1,000 runs/min (async)' },
  { icon: Timer, text: '50 min sync run limit' },
  { icon: HardDrive, text: '50GB file storage' },
  { icon: Table2, text: '25 tables · 5,000 rows each' },
]

export const MAX_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: '300 runs/min (sync)' },
  { icon: Clock, text: '2,500 runs/min (async)' },
  { icon: Timer, text: '50 min sync run limit' },
  { icon: HardDrive, text: '500GB file storage' },
  { icon: Table2, text: '25 tables · 5,000 rows each' },
]

export const TEAM_INLINE_FEATURES: PlanFeature[] = [
  { icon: Users, text: 'Shared credit pool' },
  { icon: Zap, text: 'Max plan rate limits' },
  { icon: HardDrive, text: 'Max plan file storage' },
  { icon: Table2, text: '100 tables · 10,000 rows each' },
  { icon: ShieldCheck, text: 'Access controls' },
  { icon: SlackMonoIcon, text: 'Dedicated Slack channel' },
]

export const ENTERPRISE_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: 'Custom infra limits' },
  { icon: Server, text: 'SSO' },
  { icon: ShieldCheck, text: 'SOC2' },
  { icon: HardDrive, text: 'Self hosting' },
  { icon: HeadphonesIcon, text: 'Dedicated support' },
]
