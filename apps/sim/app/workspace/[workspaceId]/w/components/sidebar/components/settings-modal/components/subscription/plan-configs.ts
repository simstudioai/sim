import {
  Clock,
  Database,
  HardDrive,
  HeadphonesIcon,
  Server,
  ShieldCheck,
  Timer,
  Users,
  Zap,
} from 'lucide-react'
import { SlackMonoIcon } from '@/components/icons'
import type { PlanFeature } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/components/plan-card'

export const PRO_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: '150 runs per minute (sync)' },
  { icon: Clock, text: '1,000 runs per minute (async)' },
  { icon: Timer, text: '50 min sync execution limit' },
  { icon: HardDrive, text: '50GB file storage' },
  { icon: Users, text: 'Unlimited invites' },
  { icon: Database, text: 'Unlimited log retention' },
]

export const TEAM_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: '300 runs per minute (sync)' },
  { icon: Clock, text: '2,500 runs per minute (async)' },
  { icon: Timer, text: '50 min sync execution limit' },
  { icon: HardDrive, text: '500GB file storage (pooled)' },
  { icon: Users, text: 'Unlimited invites' },
  { icon: Database, text: 'Unlimited log retention' },
  { icon: SlackMonoIcon, text: 'Dedicated Slack channel' },
]

export const ENTERPRISE_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: 'Custom rate limits' },
  { icon: HardDrive, text: 'Custom file storage' },
  { icon: Server, text: 'SSO' },
  { icon: ShieldCheck, text: 'SOC2' },
  { icon: HeadphonesIcon, text: 'Dedicated support' },
]
