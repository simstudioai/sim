import {
  Building2,
  Clock,
  Database,
  HeadphonesIcon,
  Infinity as InfinityIcon,
  MessageSquare,
  Server,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import type { PlanFeature } from './components/plan-card'

export const PRO_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: '25 runs per minute (sync)' },
  { icon: Clock, text: '200 runs per minute (async)' },
  { icon: Building2, text: 'Unlimited workspaces' },
  { icon: Workflow, text: 'Unlimited workflows' },
  { icon: Users, text: 'Unlimited invites' },
  { icon: Database, text: 'Unlimited log retention' },
]

export const TEAM_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: '75 runs per minute (sync)' },
  { icon: Clock, text: '500 runs per minute (async)' },
  { icon: InfinityIcon, text: 'Everything in Pro' },
  { icon: MessageSquare, text: 'Dedicated Slack channel' },
]

export const ENTERPRISE_PLAN_FEATURES: PlanFeature[] = [
  { icon: Zap, text: 'Custom rate limits' },
  { icon: Server, text: 'Enterprise hosting' },
  { icon: HeadphonesIcon, text: 'Dedicated support' },
]
