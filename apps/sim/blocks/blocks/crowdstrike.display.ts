import { CrowdStrikeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CrowdStrikeBlockDisplay = {
  type: 'crowdstrike',
  name: 'CrowdStrike',
  description: 'Query CrowdStrike Identity Protection sensors and documented aggregates',
  category: 'tools',
  bgColor: '#E01F3D',
  icon: CrowdStrikeIcon,
  iconColor: '#E01F3D',
  longDescription:
    'Integrate CrowdStrike Identity Protection into workflows to search sensors, fetch documented sensor details by device ID, and run documented sensor aggregate queries.',
  docsLink: 'https://docs.sim.ai/integrations/crowdstrike',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const CrowdStrikeBlockMeta = {
  tags: ['identity', 'monitoring'],
  url: 'https://www.crowdstrike.com',
  templates: [
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike sensor coverage gaps',
      prompt:
        'Create a scheduled workflow that queries CrowdStrike Identity Protection sensors, identifies devices reporting an unprotected or degraded status, opens a PagerDuty incident for critical gaps, and posts the list to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty', 'slack'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike weekly sensor digest',
      prompt:
        'Create a scheduled weekly workflow that runs CrowdStrike sensor aggregate queries by status and OS version, summarizes coverage and unprotected counts, and writes a digest file for security leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike + Okta coverage check',
      prompt:
        'Build a workflow that lists CrowdStrike Identity Protection sensors and cross-references them with Okta users and devices to find accounts active on endpoints that have no protected sensor, then writes the findings to a security table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
      alsoIntegrations: ['okta'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike asset inventory',
      prompt:
        'Create a scheduled workflow that queries CrowdStrike Identity Protection sensors per device, identifies endpoints reporting an unprotected status, and writes the gap list to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike stale sensor finder',
      prompt:
        'Build a scheduled workflow that queries CrowdStrike sensors, flags devices whose last heartbeat is older than a threshold, and writes the stale-sensor list to a SOC investigation table for follow-up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike coverage report doc',
      prompt:
        'Create a scheduled workflow that aggregates CrowdStrike sensor status, OS version, and policy assignment, and generates a coverage report doc in Google Docs for the security team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike policy drift watcher',
      prompt:
        'Build a scheduled workflow that queries CrowdStrike Identity Protection sensors, compares each device’s assigned IdP policy against the expected baseline, and writes mismatches to a SOC review queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'audit-identity-sensors',
      description:
        'Query CrowdStrike Identity Protection sensors and report on coverage, status, and devices missing protection.',
      content:
        '# Audit CrowdStrike Identity Sensors\n\nReview Identity Protection sensor coverage across the fleet.\n\n## Steps\n1. Query sensors, optionally filtered by status or hostname.\n2. For sensors of interest, pull detailed attributes (version, last seen, assigned policy).\n3. Flag sensors that are offline, stale, or out of policy.\n\n## Output\nA coverage report listing healthy sensors, plus any that are offline, stale, or misconfigured for SOC review.',
    },
    {
      name: 'summarize-sensor-aggregates',
      description:
        'Pull documented CrowdStrike sensor aggregates and summarize the fleet distribution by version, status, or platform.',
      content:
        '# Summarize CrowdStrike Sensor Aggregates\n\nBuild a high-level picture of the sensor fleet.\n\n## Steps\n1. Request the documented sensor aggregates (e.g. counts by version, status, or platform).\n2. Compute the distribution and identify outliers, such as a large share of outdated versions.\n3. Compare against the expected baseline.\n\n## Output\nA fleet summary with key counts and any segments that need attention (outdated, offline).',
    },
  ],
} as const satisfies BlockMeta
