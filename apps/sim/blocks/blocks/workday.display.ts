import { WorkdayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const WorkdayBlockDisplay = {
  type: 'workday',
  name: 'Workday',
  description: 'Manage workers, hiring, onboarding, and HR operations in Workday',
  category: 'tools',
  bgColor: '#F5F0EB',
  icon: WorkdayIcon,
  longDescription:
    'Integrate Workday HRIS into your workflow. Create pre-hires, hire employees, manage worker profiles, assign onboarding plans, handle job changes, retrieve compensation data, and process terminations.',
  docsLink: 'https://docs.sim.ai/integrations/workday',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay

export const WorkdayBlockMeta = {
  tags: ['hiring'],
  url: 'https://www.workday.com',
  templates: [
    {
      icon: WorkdayIcon,
      title: 'Workday new-hire kickoff',
      prompt:
        'Build a scheduled workflow that polls Workday for newly hired employees, gathers each one’s position and start date, kicks off provisioning in downstream tools, assigns an onboarding plan, schedules introductions on Google Calendar, and notifies the team in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'enterprise'],
      alsoIntegrations: ['slack', 'google_calendar'],
    },
    {
      icon: WorkdayIcon,
      title: 'Pre-hire creation pipeline',
      prompt:
        'Create a workflow exposed as a form that captures candidate details from recruiters, validates required fields, creates a pre-hire record in Workday, returns the pre-hire identifier, and logs the submission in a recruiting tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'automation'],
    },
    {
      icon: WorkdayIcon,
      title: 'Job change orchestrator',
      prompt:
        'Build a workflow that watches a Sim table of approved promotions, transfers, and demotions, performs the Workday change-job action for each row, updates downstream tools and Slack channel membership, and writes the outcome back to the table for audit.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: WorkdayIcon,
      title: 'Compensation review prep',
      prompt:
        'Create a scheduled workflow that pulls Workday workers and their current compensation, joins with a performance ratings table, drafts manager-by-manager compensation review packets as files, and emails each manager their packet ahead of the cycle.',
      modules: ['scheduled', 'tables', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: WorkdayIcon,
      title: 'Termination workflow',
      prompt:
        'Build a workflow triggered by an approved offboarding request that initiates the Workday Terminate Employee business process, deactivates downstream accounts, schedules an exit interview on Google Calendar, and writes a compliance record to an audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'compliance'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: WorkdayIcon,
      title: 'Org structure snapshot',
      prompt:
        'Create a scheduled weekly workflow that pulls Workday workers and organizations, builds an org chart file with departments and cost centers, diffs against last week to highlight structural changes, and emails the result to people leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'reporting'],
    },
    {
      icon: WorkdayIcon,
      title: 'Personal info update self-service',
      prompt:
        'Build a workflow exposed as a chat or form endpoint that takes employee-submitted personal info changes, validates the request, calls the Workday Update Personal Information action, confirms back to the employee, and logs the change in a people-operations audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'team'],
    },
  ],
  skills: [
    {
      name: 'look-up-worker',
      description: 'Find a worker in Workday and return their core profile and employment details.',
      content:
        '# Look Up a Worker in Workday\n\nRetrieve a worker record for HR review or downstream use.\n\n## Steps\n1. Resolve the worker by ID, or list workers and match on name or email.\n2. Call the get-worker operation for the matched worker.\n3. Extract the relevant fields: name, position, organization, manager, and status.\n\n## Output\nReturn the worker profile as structured fields. If multiple workers matched the search, list the candidates and ask which one before fetching full detail.',
    },
    {
      name: 'onboard-new-hire',
      description:
        'Create a pre-hire, hire the employee, and assign an onboarding plan in Workday.',
      content:
        '# Onboard a New Hire in Workday\n\nMove a candidate from pre-hire to onboarded employee.\n\n## Steps\n1. Create the pre-hire record with the candidate personal and contact details.\n2. Hire the employee using the pre-hire, setting position, organization, start date, and worker type.\n3. Assign the onboarding plan for the new worker.\n4. Confirm each step succeeded before moving to the next.\n\n## Output\nReport the new worker ID, position, start date, and the onboarding plan assigned. Stop and surface the error if any step fails rather than continuing.',
    },
    {
      name: 'process-job-change',
      description:
        'Apply a job change such as a transfer or promotion to an existing Workday worker.',
      content:
        '# Process a Job Change in Workday\n\nUpdate a worker position with a transfer, promotion, or reassignment.\n\n## Steps\n1. Look up the worker and confirm their current position and organization.\n2. Determine the new position, organization, or compensation involved in the change.\n3. Call the change-job operation with the change details and effective date.\n4. Optionally fetch compensation to confirm the new package.\n\n## Output\nReport the worker ID, the old and new position, the effective date, and confirmation the change was recorded.',
    },
    {
      name: 'update-worker-info',
      description:
        'Update a Workday worker personal information record with validated field changes.',
      content:
        '# Update Worker Personal Information\n\nApply validated personal-information changes for a worker.\n\n## Steps\n1. Look up the worker to confirm the record and current values.\n2. Validate the requested changes against expected formats before applying.\n3. Build the fields JSON with only the values that change.\n4. Call the update-worker operation and confirm acceptance.\n\n## Output\nReport which fields changed for the worker ID and confirm the update succeeded. Reject and explain any field that failed validation.',
    },
  ],
} as const satisfies BlockMeta
