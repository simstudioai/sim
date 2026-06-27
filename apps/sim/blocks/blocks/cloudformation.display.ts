import { CloudFormationIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CloudFormationBlockDisplay = {
  type: 'cloudformation',
  name: 'CloudFormation',
  description: 'Manage and inspect AWS CloudFormation stacks, resources, and drift',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: CloudFormationIcon,
  iconColor: '#FF4F8B',
  longDescription:
    'Integrate AWS CloudFormation into workflows. Describe stacks, list resources, detect drift, view stack events, retrieve templates, and validate templates. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/cloudformation',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const CloudFormationBlockMeta = {
  tags: ['cloud'],
  url: 'https://aws.amazon.com/cloudformation',
  templates: [
    {
      icon: CloudFormationIcon,
      title: 'CloudFormation drift detector',
      prompt:
        'Create a scheduled daily workflow that runs drift detection on every CloudFormation stack in my AWS account, waits for detection to complete, summarizes drifted resources, logs them to a table, and posts a Slack alert when any production stack drifts.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Stack inventory builder',
      prompt:
        'Build a scheduled weekly workflow that describes every CloudFormation stack, lists its resources, and writes a unified inventory of stacks, status, region, and resource counts into a tracking table so the platform team has a single source of truth.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'reporting'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Template validator gate',
      prompt:
        'Create a workflow triggered when a CloudFormation template is changed in a GitHub pull request. Pull the template, validate it via the CloudFormation API, summarize any syntax or structural errors, and post the validation result as a PR comment to block merges on broken templates.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'engineering'],
      alsoIntegrations: ['github'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Stack failure investigator',
      prompt:
        'Build a scheduled workflow that polls CloudFormation stack events every few minutes, detects rollbacks and create-failed events, pulls the failure reason and recent events from the stack, summarizes the root cause, opens a Linear ticket with the diagnosis, and posts to the on-call Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Template archive and search',
      prompt:
        'Create a scheduled workflow that retrieves the deployed template for every CloudFormation stack, stores each template as a versioned file in your files store, and updates a knowledge base so engineers can search infrastructure definitions in natural language.',
      modules: ['scheduled', 'files', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'research'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Resource change report',
      prompt:
        'Build a scheduled weekly workflow that pulls CloudFormation stack events, summarizes resource creates, updates, and deletes across the account, classifies risky changes, and writes a written change report file for platform leadership review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'enterprise'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Pre-deploy drift gate',
      prompt:
        'Create a workflow that runs before a deploy, initiates drift detection on the target CloudFormation stack, polls until drift detection completes, and either approves the deploy or blocks it with a Slack alert explaining the drifted resources.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'detect-stack-drift',
      description:
        'Run drift detection on CloudFormation stacks and summarize resources whose live config no longer matches the template.',
      content:
        '# Detect CloudFormation Stack Drift\n\nFind resources that have been changed outside of CloudFormation.\n\n## Steps\n1. List the target stacks (or accept a specific stack name).\n2. Initiate drift detection for each stack and poll until detection completes.\n3. Pull the drift results and isolate resources with status DRIFTED or DELETED.\n4. For each drifted resource, summarize the property differences.\n\n## Output\nA per-stack drift report listing each drifted resource, its type, and the specific properties that differ from the template.',
    },
    {
      name: 'inventory-stacks',
      description:
        'List CloudFormation stacks with their status, region, and resources to build a single inventory of deployed infrastructure.',
      content:
        '# Inventory CloudFormation Stacks\n\nBuild a unified view of all deployed stacks.\n\n## Steps\n1. List every stack and capture name, status, creation/update time, and region.\n2. For each stack, describe its resources and count them by type.\n3. Highlight stacks in failed or rollback states.\n\n## Output\nA table of stacks with status, region, resource count, and any stacks needing attention.',
    },
    {
      name: 'investigate-stack-failure',
      description:
        'Pull recent CloudFormation stack events to diagnose a failed create, update, or rollback and explain the root cause.',
      content:
        '# Investigate CloudFormation Stack Failure\n\nDiagnose why a stack operation failed.\n\n## Steps\n1. Describe the target stack and confirm its current status.\n2. Pull recent stack events, ordered newest first.\n3. Find the first FAILED event and read its resource status reason.\n4. Trace any dependent resource failures that cascaded from it.\n\n## Output\nA plain-English root-cause summary naming the failing resource, the error reason, and a suggested fix.',
    },
  ],
} as const satisfies BlockMeta
