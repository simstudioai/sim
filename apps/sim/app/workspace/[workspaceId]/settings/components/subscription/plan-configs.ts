import {
  Clock,
  HardDrive,
  HeadphonesIcon,
  Server,
  ShieldCheck,
  Timer,
  Users,
  Zap,
} from 'lucide-react'
import { SlackMonoIcon } from '@/components/icons'
import type { PlanFeature } from '@/app/workspace/[workspaceId]/settings/components/subscription/components/plan-card'

export const PRO_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: '150 runs/min (sync)' },
  { icon: Clock, text: '1,000 runs/min (async)' },
  { icon: Timer, text: '50 min sync execution limit' },
  { icon: HardDrive, text: '50GB file storage' },
]

export const TEAM_INLINE_FEATURES: PlanFeature[] = [
  { icon: Users, text: 'Shared credit pool' },
  { icon: Zap, text: 'Higher rate limits' },
  { icon: HardDrive, text: 'More file storage' },
  { icon: ShieldCheck, text: 'Access control' },
  { icon: SlackMonoIcon, text: 'Dedicated Slack channel' },
]

export const ENTERPRISE_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: 'Custom infra limits' },
  { icon: Server, text: 'SSO' },
  { icon: ShieldCheck, text: 'SOC2' },
  { icon: HardDrive, text: 'Self hosting' },
  { icon: HeadphonesIcon, text: 'Dedicated support' },
]
