import { GreenhouseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GreenhouseBlockDisplay = {
  type: 'greenhouse',
  name: 'Greenhouse',
  description: 'Manage candidates, jobs, and applications in Greenhouse',
  category: 'tools',
  bgColor: '#469776',
  icon: GreenhouseIcon,
  iconColor: '#469776',
  longDescription:
    'Integrate Greenhouse into the workflow. List and retrieve candidates, jobs, applications, users, departments, offices, and job stages from your Greenhouse ATS account.',
  docsLink: 'https://docs.sim.ai/integrations/greenhouse',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay

export const GreenhouseBlockMeta = {
  tags: ['hiring'],
  url: 'https://www.greenhouse.com',
  templates: [
    {
      icon: GreenhouseIcon,
      title: 'Recruiting pipeline automator',
      prompt:
        'Build a scheduled workflow that syncs open jobs and candidates from Greenhouse to a tracking table daily, flags candidates who have been in the same stage for more than 5 days, and sends a Slack summary to hiring managers with pipeline stats and bottlenecks.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse to onboarding kickoff',
      prompt:
        'Build a workflow that fires when a Greenhouse application is marked hired, gathers the new hire profile, kicks off an onboarding plan in a table, schedules week-one meetings via Google Calendar, and posts a welcome announcement to Slack.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'team'],
      alsoIntegrations: ['google_calendar', 'slack'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse candidate enricher',
      prompt:
        'Create a workflow that watches for new Greenhouse candidates, enriches each profile with LinkedIn background, GitHub activity, and public writing, and writes a structured research summary to a recruiting table for recruiters to review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'research'],
      alsoIntegrations: ['linkedin', 'github'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse interview scheduler',
      prompt:
        'Build a workflow that runs after a Greenhouse application reaches the interview stage, finds the right interviewer panel based on job stage, proposes time slots from Google Calendar, drafts a coordination email to the candidate, and confirms the booking in a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'automation'],
      alsoIntegrations: ['google_calendar', 'gmail'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse offer drafter',
      prompt:
        'Create a workflow that takes an approved Greenhouse application, pulls compensation bands from a knowledge base, drafts a tailored offer letter file, prepares an explanation email, and routes both to the hiring manager for review before sending to the candidate.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'content'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse rejection follow-up',
      prompt:
        'Build a workflow that runs when a Greenhouse candidate is rejected, drafts a warm and respectful rejection email tailored to how far they progressed, sends it via Gmail, and logs the candidate with their interest areas to a future-talent table for re-engagement.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'communication', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse interview prep packet',
      prompt:
        'Create a workflow that runs the morning of every Greenhouse interview, pulls the candidate profile, prior interview notes, and job rubric, assembles a one-page prep file for the interviewer, and emails it with a Slack DM reminder thirty minutes before the slot.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'team'],
      alsoIntegrations: ['gmail', 'slack'],
    },
  ],
  skills: [
    {
      name: 'build-pipeline-report',
      description:
        'Summarize Greenhouse applications per job by stage to produce a hiring pipeline report.',
      content:
        '# Build Pipeline Report\n\nReport how candidates are progressing through each open job.\n\n## Steps\n1. List jobs and filter to open requisitions, capturing job IDs and titles.\n2. List job stages so application counts can be bucketed correctly.\n3. List applications, optionally filtered by status, and group them by job and current stage.\n4. Compute counts per stage and flag jobs with no recent movement.\n\n## Output\nReturn a per-job breakdown showing candidate counts by stage, total active candidates, and a flagged list of stalled requisitions. Suitable for a weekly recruiting standup.',
    },
    {
      name: 'assemble-candidate-brief',
      description:
        'Pull a Greenhouse candidate and their application details into a one-page interviewer brief.',
      content:
        '# Assemble Candidate Brief\n\nCompile everything an interviewer needs about a candidate.\n\n## Steps\n1. Find the candidate by listing candidates and matching name, or use a known candidate ID.\n2. Get the candidate to retrieve profile details and attachments.\n3. Get the application to read the job applied for, current stage, and source.\n4. Get the job for the role context and requirements.\n\n## Output\nReturn a one-page brief: candidate summary, role and current stage, key background points, and any notes. Ready to email or DM to the interviewer before the slot.',
    },
    {
      name: 'audit-open-roles',
      description: 'List open Greenhouse jobs with their departments, offices, and hiring teams.',
      content:
        '# Audit Open Roles\n\nInventory active requisitions and who owns them.\n\n## Steps\n1. List jobs and filter to open status.\n2. List departments and offices to resolve the names referenced on each job.\n3. List users to map hiring team members and recruiters to each role.\n4. Assemble each job with its department, office, and owning team.\n\n## Output\nReturn an inventory of open roles, each with title, department, office, and hiring team. Flag any role missing a recruiter or hiring manager.',
    },
  ],
} as const satisfies BlockMeta
