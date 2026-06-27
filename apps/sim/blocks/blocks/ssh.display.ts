import { SshIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SSHBlockDisplay = {
  type: 'ssh',
  name: 'SSH',
  description: 'Connect to remote servers via SSH',
  category: 'tools',
  bgColor: '#000000',
  icon: SshIcon,
  longDescription:
    'Execute commands, transfer files, and manage remote servers via SSH. Supports password and private key authentication for secure server access.',
  docsLink: 'https://docs.sim.ai/integrations/ssh',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
