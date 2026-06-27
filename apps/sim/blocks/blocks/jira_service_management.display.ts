import { JiraServiceManagementIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const JiraServiceManagementBlockDisplay = {
  type: 'jira_service_management',
  name: 'Jira Service Management',
  description: 'Interact with Jira Service Management',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: JiraServiceManagementIcon,
  longDescription:
    'Integrate with Jira Service Management for IT service management. Create and manage service requests, handle customers and organizations, track SLAs, and manage queues.',
  docsLink: 'https://docs.sim.ai/integrations/jira_service_management',
  integrationType: IntegrationType.Support,
} satisfies BlockDisplay

export const JiraServiceManagementBlockMeta = {
  tags: ['customer-support', 'ticketing', 'incident-management'],
  url: 'https://www.atlassian.com/software/jira/service-management',
  templates: [
    {
      icon: JiraServiceManagementIcon,
      title: 'JSM major incident broadcaster',
      prompt:
        'Build a workflow triggered when a major-incident request is created in Jira Service Management that pulls the affected service from PagerDuty, identifies the current on-call, posts a structured incident brief to a Slack war-room channel, and adds the responders as JSM request participants.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'engineering', 'automation'],
      alsoIntegrations: ['slack', 'pagerduty'],
    },
    {
      icon: JiraServiceManagementIcon,
      title: 'JSM request auto-triage',
      prompt:
        'Create a workflow triggered by new Jira Service Management requests that classifies the request type, sets the correct priority based on impact and urgency, transitions it to the right initial status, and adds the assignment-group customer organization as a participant.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['support', 'automation', 'enterprise'],
    },
    {
      icon: JiraServiceManagementIcon,
      title: 'JSM approval router',
      prompt:
        'Build a workflow that watches Jira Service Management requests for new approval steps, posts a Slack DM to each approver with request context and quick-action buttons, and answers the approval in JSM based on their response while keeping the request in sync.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JiraServiceManagementIcon,
      title: 'JSM form auto-completer',
      prompt:
        'Create a workflow that when a Jira Service Management request is created with an attached ProForma form, pre-fills the answers from the requester profile, attached email, and CMDB lookup, and saves the answers so agents only review rather than retype.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
    },
    {
      icon: JiraServiceManagementIcon,
      title: 'JSM weekly service desk report',
      prompt:
        'Build a scheduled weekly workflow that pulls Jira Service Management request volume by queue, SLA performance, top request types, and bottleneck assignees, and generates a service desk health report file for the operations review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis', 'enterprise'],
    },
    {
      icon: JiraServiceManagementIcon,
      title: 'JSM-to-ServiceNow bridge',
      prompt:
        'Create a workflow that mirrors Jira Service Management incident requests into ServiceNow incident records and vice versa, keeping status, assignment, and comments in sync so teams on either side see the same truth.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync', 'automation'],
      alsoIntegrations: ['servicenow'],
    },
    {
      icon: JiraServiceManagementIcon,
      title: 'JSM self-service deflection bot',
      prompt:
        "Create a knowledge base from internal IT docs, then build a Slack agent that answers employee help requests with cited steps and, when it can't resolve the issue, creates a Jira Service Management request with the right request type so nothing falls through.",
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'team'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'raise-service-request',
      description:
        'Create a customer request on the right service desk with the correct request type.',
      content:
        '# Raise a Service Request\n\nLog an inbound customer request into the correct Jira Service Management queue.\n\n## Steps\n1. Get service desks and identify the right one for the request.\n2. Get request types for that service desk and choose the matching type.\n3. Create the request with a clear summary, description, and any required request-type fields.\n4. Capture the request key and reporter.\n\n## Output\nReturn the request key, the service desk and request type used, and the reporter. Confirm required fields were filled.',
    },
    {
      name: 'respond-and-update-request',
      description: 'Add a public reply to a customer request and move it to the right status.',
      content:
        '# Respond and Update a Request\n\nReply to a customer on their request and advance it.\n\n## Steps\n1. Get the request and read its history and current status.\n2. Add a comment with the response (public to the customer).\n3. Get available transitions and move the request to the appropriate status.\n\n## Output\nReturn the request key, the comment added, and the new status.',
    },
    {
      name: 'sla-breach-watch',
      description: 'Scan open requests on a queue and flag ones at risk of breaching SLA.',
      content:
        '# SLA Breach Watch\n\nSurface requests that are about to miss their SLA so the team can act.\n\n## Steps\n1. Get the service desk and its queues, then get requests in the target queue.\n2. For each request, get its SLA information and time remaining.\n3. Flag requests that are breached or close to breaching their target.\n\n## Output\nReturn a prioritized list of at-risk requests with key, summary, SLA metric, and time remaining, worst first.',
    },
  ],
} as const satisfies BlockMeta
