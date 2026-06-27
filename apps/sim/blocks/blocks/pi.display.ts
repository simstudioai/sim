import { PiIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PiBlockDisplay = {
  type: 'pi',
  name: 'Pi Coding Agent',
  description: 'Run an autonomous coding agent on a repo',
  category: 'blocks',
  bgColor: '#000000',
  icon: PiIcon,
  longDescription:
    'The Pi Coding Agent runs the Pi harness against a real repository. In Cloud mode it spins up an isolated sandbox, clones a connected GitHub repo, edits and tests with native shell + git, and opens a pull request. In Local mode it edits files on your own machine over SSH. Both modes stream progress and reuse your models, skills, and multi-turn memory.',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
