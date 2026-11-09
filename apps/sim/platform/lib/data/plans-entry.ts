import 'server-only'
import { redirect } from 'next/navigation'
import {
  buildHostedUpgradeUrl,
  DEFAULT_UPGRADE_HEADER,
  isUpgradeReason,
  UPGRADE_REASON_COPY,
  UPGRADE_REASON_PARAM,
} from '@/lib/billing/upgrade-reasons'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/**
 * The legacy upgrade page's gates for the organization's plans: a self-hosted deployment buys its
 * plan on the hosted app, and a deployment without billing has no plans to show. Returns what the
 * picker renders, or nothing when the shell already answered a failed surface read.
 */
export async function resolvePlansEntry(query: Record<string, string | string[] | undefined>) {
  const raw = query[UPGRADE_REASON_PARAM]
  const value = Array.isArray(raw) ? raw[0] : raw
  const reason = isUpgradeReason(value) ? value : undefined
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  const { organization, deployment } = surface.organization
  if (!deployment.hosted) redirect(buildHostedUpgradeUrl(reason))
  if (!deployment.billingEnabled) redirect('/')
  return {
    organizationId: organization.id,
    header: reason ? UPGRADE_REASON_COPY[reason].header : DEFAULT_UPGRADE_HEADER,
  }
}
