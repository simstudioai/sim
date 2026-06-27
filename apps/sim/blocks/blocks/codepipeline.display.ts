import { CodePipelineIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CodePipelineBlockDisplay = {
  type: 'codepipeline',
  name: 'CodePipeline',
  description: 'Run, monitor, and approve AWS CodePipeline pipelines',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: CodePipelineIcon,
  iconColor: '#527FFF',
  longDescription:
    'Integrate AWS CodePipeline into workflows. Start, stop, and monitor pipeline executions, retry failed stages, and approve or reject manual approval actions. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/codepipeline',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const CodePipelineBlockMeta = {
  tags: ['cloud', 'ci-cd'],
  url: 'https://aws.amazon.com/codepipeline',
  templates: [
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline deploy approver',
      prompt:
        'Build a workflow that checks a CodePipeline pipeline for pending manual approvals, posts the change summary and source revisions to Slack, and approves or rejects the deployment based on the team lead reply.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline failure triage',
      prompt:
        'Create a scheduled workflow that polls CodePipeline executions every few minutes, and when one fails, pulls the pipeline state to find the failing stage and action error, opens a Linear issue, and alerts the on-call channel in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline release train',
      prompt:
        'Build a scheduled workflow that starts the release CodePipeline pipeline every weekday at 9am with the release version as a pipeline variable, then posts the execution ID and a link to Slack.',
      modules: ['scheduled', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline deploy digest',
      prompt:
        'Create a scheduled daily workflow that lists executions across the team CodePipeline pipelines, summarizes successes, failures, and rollbacks with their source revisions, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline flaky-stage retrier',
      prompt:
        'Build a scheduled workflow that finds failed CodePipeline executions, retries the failed stage once with failed-actions mode, and escalates to PagerDuty if the retry fails again.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline rollback brake',
      prompt:
        'Create a workflow that watches CloudWatch alarms after a deployment, and when an error-rate alarm fires while a CodePipeline execution is in progress, stops the execution with a reason and notifies the release channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['cloudwatch', 'slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline deployment audit log',
      prompt:
        'Build a scheduled workflow that records every CodePipeline execution — pipeline, status, trigger, source revisions, and timing — into a table for compliance and deployment-frequency reporting.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'approve-pending-deployment',
      description:
        'Find a pending CodePipeline manual approval, summarize the change, and approve or reject it.',
      content:
        '# Approve Pending CodePipeline Deployment\n\nHandle a manual approval gate in a pipeline.\n\n## Steps\n1. Get the pipeline state and locate the action awaiting approval (status InProgress on a manual approval action) and its approval token.\n2. Pull the execution details for the stage to summarize what is being deployed (source revisions, trigger).\n3. Submit the approval result with the token, the Approved or Rejected decision, and a summary explaining the decision.\n\n## Output\nThe decision that was submitted, the approval summary, and the pipeline/stage/action it applied to.',
    },
    {
      name: 'investigate-failed-pipeline',
      description:
        'Find the failing stage and action of a CodePipeline execution and report the error details.',
      content:
        '# Investigate Failed CodePipeline Execution\n\nDiagnose why a pipeline run failed.\n\n## Steps\n1. List recent executions for the pipeline and identify the failed one (or use the provided execution ID).\n2. Get the pipeline state and find the stage and action with a Failed status.\n3. Capture the action error code, error message, and external execution URL, plus the source revisions that were being deployed.\n\n## Output\nThe failing stage and action, the error details, the commit/revision involved, and a link to the external execution.',
    },
    {
      name: 'trigger-pipeline-release',
      description:
        'Start a CodePipeline execution, optionally with variable overrides, and report the execution ID.',
      content:
        '# Trigger CodePipeline Release\n\nKick off a pipeline run.\n\n## Steps\n1. Confirm the pipeline name (list pipelines if unsure).\n2. Start the execution, passing any pipeline variable overrides (e.g. version or environment) and an idempotency token if retries are possible.\n3. Optionally poll the pipeline state to confirm the execution entered the first stage.\n\n## Output\nThe pipeline execution ID that was started and the variables it ran with.',
    },
    {
      name: 'retry-failed-stage',
      description:
        'Retry the failed actions of a CodePipeline stage and confirm the stage re-entered execution.',
      content:
        '# Retry Failed CodePipeline Stage\n\nRe-run a failed stage without restarting the whole pipeline.\n\n## Steps\n1. Get the pipeline state and identify the failed stage and the execution ID stuck in it.\n2. Retry the stage with FAILED_ACTIONS mode (or ALL_ACTIONS if the whole stage should re-run).\n3. Check the pipeline state again to confirm the stage is InProgress.\n\n## Output\nThe stage that was retried, the retry mode used, and the current stage status.',
    },
  ],
} as const satisfies BlockMeta
