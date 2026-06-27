import { CloudflareIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CloudflareBlockDisplay = {
  type: 'cloudflare',
  name: 'Cloudflare',
  description: 'Manage DNS, domains, certificates, and cache',
  category: 'tools',
  bgColor: '#F5F6FA',
  icon: CloudflareIcon,
  longDescription:
    'Integrate Cloudflare into the workflow. Manage zones (domains), DNS records, SSL/TLS certificates, zone settings, DNS analytics, and cache purging via the Cloudflare API.',
  docsLink: 'https://docs.sim.ai/integrations/cloudflare',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const CloudflareBlockMeta = {
  tags: ['cloud', 'monitoring'],
  url: 'https://www.cloudflare.com',
  templates: [
    {
      icon: CloudflareIcon,
      title: 'Cloudflare DNS change tracker',
      prompt:
        'Create a scheduled workflow that pulls every Cloudflare DNS record for my zones each hour, diffs the snapshot against the previous run, logs added, removed, and modified records to a table, and posts a Slack alert when sensitive records like MX or NS change.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cache purge on deploy',
      prompt:
        'Build a workflow that fires when a Vercel deployment succeeds on production, purges the Cloudflare cache for the affected hostnames, verifies the new content is being served, and posts a confirmation message to Slack with the purged paths.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['vercel', 'slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'SSL and zone health check',
      prompt:
        'Create a scheduled weekly workflow that inspects every Cloudflare zone for SSL certificate status, security level, and zone settings drift, logs findings to a table, and opens Linear tickets for any zones that need attention.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'enterprise'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: CloudflareIcon,
      title: 'DNS analytics digest',
      prompt:
        'Build a scheduled workflow that pulls Cloudflare DNS analytics for the top zones every Monday, identifies query spikes, anomalies, and surges in particular record types, and emails a written analysis to the platform team with traffic graphs and recommendations.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'analysis'],
    },
    {
      icon: CloudflareIcon,
      title: 'Zone provisioning workflow',
      prompt:
        'Create a workflow that accepts a domain name from a form, creates a new Cloudflare zone, sets opinionated default DNS records and zone settings, generates the nameserver instructions, and posts the setup summary to Slack so the team can finalize delegation.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'DNS record bulk importer',
      prompt:
        'Build a workflow that reads a table of DNS records — name, type, content, TTL — validates each row, creates or updates the matching record in Cloudflare, and writes results back to the table so DNS changes are versioned and reviewable.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: CloudflareIcon,
      title: 'Zone settings policy enforcer',
      prompt:
        'Create a scheduled workflow that reads a baseline of required Cloudflare zone settings from a knowledge base, compares it against every zone weekly, automatically reverts unauthorized changes, and emails a compliance report to security leadership.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'audit-dns-records',
      description:
        'Pull all DNS records for a Cloudflare zone and report on misconfigurations, dangling records, and sensitive record changes.',
      content:
        '# Audit Cloudflare DNS Records\n\nExport and review the DNS configuration for a zone to catch misconfigurations and risky records.\n\n## Steps\n1. Resolve the zone ID for the target domain.\n2. List every DNS record (A, AAAA, CNAME, MX, TXT, NS) for the zone.\n3. Flag records that point to deprovisioned hosts, wildcard CNAMEs, missing SPF/DMARC TXT records, and proxied vs. unproxied mismatches.\n4. Group findings by record type and severity.\n\n## Output\nA prioritized list of DNS issues with the record name, type, current value, and recommended fix.',
    },
    {
      name: 'purge-cache',
      description:
        'Purge Cloudflare cache for specific URLs or an entire zone after a deploy, then confirm what was cleared.',
      content:
        '# Purge Cloudflare Cache\n\nClear cached content so visitors see the latest deploy.\n\n## Steps\n1. Identify the affected zone and the paths or hostnames that changed.\n2. Purge by specific files when possible; only purge everything for the zone if the change is global.\n3. Confirm the purge succeeded and note the timestamp.\n\n## Output\nA short confirmation listing the zone, the purged URLs (or "full zone"), and the purge time.',
    },
    {
      name: 'check-ssl-and-zone-settings',
      description:
        'Inspect SSL certificate status and security settings for Cloudflare zones and report drift from a desired baseline.',
      content:
        '# Check SSL and Zone Settings\n\nVerify SSL/TLS posture and key security settings across zones.\n\n## Steps\n1. List the target zones.\n2. For each zone read SSL mode, certificate status/expiry, minimum TLS version, and security level.\n3. Compare against the desired baseline (e.g. Full Strict, TLS 1.2+).\n4. Flag expiring certs and any setting weaker than the baseline.\n\n## Output\nA per-zone table of SSL status, settings, and any drift that needs remediation.',
    },
  ],
} as const satisfies BlockMeta
