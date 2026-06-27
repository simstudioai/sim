import { VercelIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const VercelBlockDisplay = {
  type: 'vercel',
  name: 'Vercel',
  description: 'Manage Vercel deployments, projects, and infrastructure',
  category: 'tools',
  bgColor: '#171717',
  icon: VercelIcon,
  longDescription:
    'Integrate with Vercel to manage deployments, projects, domains, DNS records, environment variables, aliases, edge configs, teams, and more.',
  docsLink: 'https://docs.sim.ai/integrations/vercel',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const VercelBlockMeta = {
  tags: ['cloud', 'ci-cd'],
  url: 'https://vercel.com',
  templates: [
    {
      icon: VercelIcon,
      title: 'Vercel deployment monitor',
      prompt:
        'Build a scheduled workflow that polls Vercel for the latest deployments across my projects every five minutes, detects failed or stuck builds, fetches the build logs, summarizes the failure cause, and posts an actionable alert to Slack with a deep link to the deployment.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VercelIcon,
      title: 'Preview deployment reviewer',
      prompt:
        'Build a workflow that watches GitHub pull requests, finds the matching Vercel preview deployment, captures the preview URL, runs a smoke check against critical pages, and posts a status comment on the pull request with the preview link and any issues found.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'engineering', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: VercelIcon,
      title: 'Environment variable auditor',
      prompt:
        'Create a scheduled weekly workflow that pulls environment variables from every Vercel project, compares them to a reference list in a table, flags drift, missing keys, and stale values, and emails a remediation report to the platform team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'monitoring'],
    },
    {
      icon: VercelIcon,
      title: 'Domain and DNS inventory',
      prompt:
        'Build a scheduled workflow that lists every domain and DNS record across my Vercel account weekly, logs them into a tracking table, and sends a Slack diff of any added, removed, or modified records so DNS changes never go unnoticed.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VercelIcon,
      title: 'Project pause guard',
      prompt:
        'Build a scheduled workflow that scans Vercel projects daily for low-traffic or stale candidates flagged in a table, pauses projects that meet the criteria, and Slacks a digest of paused and unpaused projects to the platform team for review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VercelIcon,
      title: 'Deploy log triage',
      prompt:
        'Create a workflow that fires after each Vercel deployment, fetches the build and runtime logs, classifies warnings and errors with an agent, groups recurring issues, and opens a Linear ticket per cluster so platform regressions get addressed early.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: VercelIcon,
      title: 'Failed deployment recovery',
      prompt:
        'Build a workflow that watches Vercel for failed production deployments, identifies the last known good production deployment, promotes it back to production for an instant rollback, and posts a Slack incident summary with the failure cause and rollback confirmation.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'monitor-deployments',
      description: 'List recent Vercel deployments, surface failed builds, and pull their logs.',
      content:
        '# Monitor Vercel Deployments\n\nKeep an eye on builds so failures are caught fast.\n\n## Steps\n1. Use the List Deployments operation with your access token, optionally filtering by Project ID, Target (production), and State (ERROR).\n2. For any failed or stuck deployment, use Get Deployment Logs with the Deployment ID to pull the build events.\n3. Summarize the failure cause from the log events.\n4. Use Get Deployment for full detail including the deployment URL and state.\n\n## Output\nReturn the list of deployments with their state, plus a short summary of any failed build and a link to investigate.',
    },
    {
      name: 'rollback-deployment',
      description:
        'Promote the last known good Vercel deployment to instantly roll back a bad release.',
      content:
        '# Roll Back a Vercel Deployment\n\nRecover production by instantly promoting a previous good deployment back to production.\n\n## Steps\n1. Use List Deployments filtered to the project, Target production, and State READY to find the last good deployment.\n2. Use the Promote Deployment operation with the Project ID and that good deployment ID to restore it to production instantly, with no rebuild.\n3. Optionally use Cancel Deployment on the broken build that is still running.\n\n## Output\nReturn the promoted deployment ID and confirmation so the rollback can be announced.',
    },
    {
      name: 'manage-env-vars',
      description: 'Read, create, or update environment variables on a Vercel project.',
      content:
        '# Manage Vercel Environment Variables\n\nKeep a project configuration correct across environments.\n\n## Steps\n1. Use Get Environment Variables with the Project ID to read the current variables.\n2. To add one, use Create Environment Variable with the Key, Value, Target Environments (for example production,preview), and Variable Type.\n3. To change one, use Update Environment Variable with the Env Variable ID and the new value.\n4. Use Delete Environment Variable with the Env Variable ID to remove a stale key.\n\n## Output\nReturn the resulting variable list or confirmation of the create, update, or delete so configuration changes are auditable.',
    },
    {
      name: 'audit-domains-and-dns',
      description: 'Inventory Vercel domains and DNS records and manage records for a domain.',
      content:
        '# Audit Vercel Domains and DNS\n\nTrack domains and DNS so changes never go unnoticed.\n\n## Steps\n1. Use List Domains for the account inventory, and List DNS Records with a Domain to see its records.\n2. To add a record, use Create DNS Record with the Domain, Record Name, Record Type (A, CNAME, TXT, etc.), and Value.\n3. To remove one, use Delete DNS Record with the Domain and Record ID.\n4. Use Get Domain Config to verify a domain is correctly configured.\n\n## Output\nReturn the domain and DNS record inventory, or confirmation of any record change, for the tracking log.',
    },
  ],
} as const satisfies BlockMeta
