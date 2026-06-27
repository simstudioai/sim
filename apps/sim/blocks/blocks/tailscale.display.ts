import { TailscaleIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TailscaleBlockDisplay = {
  type: 'tailscale',
  name: 'Tailscale',
  description: 'Manage devices and network settings in your Tailscale tailnet',
  category: 'tools',
  bgColor: '#2E2D2D',
  icon: TailscaleIcon,
  longDescription:
    'Interact with the Tailscale API to manage devices, DNS, ACLs, auth keys, users, and routes across your tailnet.',
  docsLink: 'https://docs.sim.ai/integrations/tailscale',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const TailscaleBlockMeta = {
  tags: ['monitoring'],
  url: 'https://tailscale.com',
  templates: [
    {
      icon: TailscaleIcon,
      title: 'Tailscale device inventory',
      prompt:
        'Build a scheduled workflow that pulls Tailscale device inventory daily, identifies stale or non-compliant nodes, and writes a security review table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale ACL drift detector',
      prompt:
        'Create a scheduled workflow that diffs Tailscale ACLs against the source of truth, alerts on drift, and writes the drift report to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale new-hire provisioner',
      prompt:
        'Build a workflow that on a Workday new-hire event creates a scoped Tailscale auth key for the engineer, sets the right device tags, and writes the access record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale offboarder',
      prompt:
        "Create a workflow that on a Workday termination deletes the departing engineer's Tailscale devices, revokes their auth keys, and writes the security audit log.",
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale unauthorized-tag watcher',
      prompt:
        'Build a scheduled workflow that polls Tailscale device tags and the ACL for unauthorized changes, posts a Slack alert to the security channel, and writes the audit.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale key-expiry sweeper',
      prompt:
        'Create a scheduled workflow that lists Tailscale auth keys expiring in 14 days, notifies owners, and rotates keys past their grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale access audit',
      prompt:
        'Build a scheduled monthly workflow that produces a Tailscale access-review report — devices, tags, ACL effective access — for the security team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'audit-tailnet-devices',
      description:
        'List every device in the tailnet and flag stale, unauthorized, or update-pending nodes.',
      content:
        '# Audit Tailnet Devices\n\nProduce a clean inventory of the devices on your tailnet and surface the ones that need attention.\n\n## Steps\n1. Use the List Devices operation with your API key and tailnet (use "-" for the default tailnet).\n2. For each device review lastSeen, authorized, updateAvailable, and the assigned tags.\n3. Flag nodes not seen in 30+ days, devices still pending authorization, and any with an update available.\n4. Use Get Device with a deviceId to pull full detail on anything suspicious.\n\n## Output\nReturn a table of devices with hostname, user, OS, last seen, and authorization status, plus a short list of nodes that need review.',
    },
    {
      name: 'provision-auth-key',
      description:
        'Create a scoped Tailscale auth key with the right tags, reusability, and expiry for onboarding.',
      content:
        '# Provision a Tailscale Auth Key\n\nGenerate an auth key so a new device or user can join the tailnet with the correct access.\n\n## Steps\n1. Use the Create Auth Key operation with your API key and tailnet.\n2. Set Tags (for example tag:server,tag:production) so devices joining with the key get the intended ACL access.\n3. Choose Reusable, Ephemeral, and Preauthorized values to match the use case (ephemeral for short-lived CI nodes).\n4. Set an Expiry in seconds (for example 7776000 for 90 days) and a clear Description.\n\n## Output\nReturn the generated key value once (it is only shown at creation), the key ID, its tags, and the expiry timestamp.',
    },
    {
      name: 'offboard-device',
      description: 'Deauthorize or remove a departing user device and revoke its auth keys.',
      content:
        '# Offboard a Tailscale Device\n\nRemove a device from the tailnet during offboarding so access is cut cleanly.\n\n## Steps\n1. Use List Devices to find the deviceId tied to the departing user.\n2. To immediately cut access use Authorize Device set to Deauthorize, or Delete Device to remove it entirely.\n3. Use List Auth Keys to find any keys the user created, then Delete Auth Key for each.\n4. Capture the device detail with Get Device before deletion if you need an audit record.\n\n## Output\nConfirm the device was deauthorized or deleted and list the revoked auth keys for the offboarding audit log.',
    },
  ],
} as const satisfies BlockMeta
