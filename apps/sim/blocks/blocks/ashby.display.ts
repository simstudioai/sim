import { AshbyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AshbyBlockDisplay = {
  type: 'ashby',
  name: 'Ashby',
  description: 'Manage candidates, jobs, and applications in Ashby',
  category: 'tools',
  bgColor: '#5D4ED6',
  icon: AshbyIcon,
  iconColor: '#5D4ED6',
  longDescription:
    'Integrate Ashby into the workflow. Manage candidates (list, get, create, update, search, tag), applications (list, get, create, change stage), jobs (list, get), job postings (list, get), offers (list, get), notes (list, create), interviews (list), and reference data (sources, tags, archive reasons, custom fields, departments, locations, openings, users).',
  docsLink: 'https://docs.sim.ai/integrations/ashby',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay

export const AshbyBlockMeta = {
  tags: ['hiring'],
  url: 'https://ashbyhq.com',
  templates: [
    {
      icon: AshbyIcon,
      title: 'Ashby pipeline digest',
      prompt:
        'Build a scheduled daily workflow that lists open Ashby jobs, summarizes candidate counts per stage, flags applications stalled for more than five days, logs metrics to a tracking table, and Slacks hiring managers a personalized pipeline digest.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AshbyIcon,
      title: 'Resume to Ashby candidate',
      prompt:
        'Create a workflow that watches a folder of inbound resumes, extracts contact info and work history, deduplicates against existing Ashby candidates, creates new candidate records when needed, and tags them with the source job they applied through.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'automation'],
    },
    {
      icon: AshbyIcon,
      title: 'Interview note logger',
      prompt:
        'Build a workflow that runs after every interview is logged in your meeting tool, summarizes the transcript, scores the candidate against the job requirements, creates a structured note on the matching Ashby candidate, and notifies the hiring manager in Slack.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AshbyIcon,
      title: 'Stage-change responder',
      prompt:
        'Create a workflow that detects when an Ashby application moves into a new stage, sends the candidate a stage-appropriate email, prepares the interviewer brief in a file, and updates a recruiting tracking table so coordinators always know who is next.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AshbyIcon,
      title: 'Ashby DEI snapshot',
      prompt:
        'Build a scheduled monthly workflow that pulls Ashby candidates, applications, and openings, computes funnel diversity metrics by stage, role, and source, and writes a confidential report file shared with people leadership and compliance.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'reporting'],
    },
    {
      icon: AshbyIcon,
      title: 'Candidate research enricher',
      prompt:
        'Create a workflow that takes new Ashby candidates, researches each across LinkedIn and the web for relevant background, writes a structured profile summary onto the candidate as an Ashby note, and updates a recruiting table with research links.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'research'],
      alsoIntegrations: ['linkedin'],
    },
    {
      icon: AshbyIcon,
      title: 'Offer ready brief',
      prompt:
        'Build a workflow that runs when an Ashby application reaches the offer stage, gathers compensation benchmarks, interview feedback, and candidate priorities, drafts an offer brief file for the hiring manager, and Slacks the people team to start the offer process.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'add-candidate',
      description:
        'Create a candidate in Ashby from an inbound application or referral and attach them to a job. Use for sourcing and referral intake.',
      content:
        '# Add Candidate\n\nCapture a new candidate into Ashby and link them to the right role.\n\n## Steps\n1. Gather the candidate name, email, source, and the target job.\n2. If the job is named, list jobs to resolve its ID.\n3. Create the candidate, then create an application linking them to the job with the correct source.\n4. Add a note with referral context or screening details, and apply any relevant tags.\n\n## Output\nReport the created candidate and application IDs, the linked job, and the source applied.',
    },
    {
      name: 'advance-candidate-stage',
      description:
        'Move a candidate application to a new interview stage in Ashby and log the decision. Use to keep the pipeline moving after interviews.',
      content:
        '# Advance Candidate Stage\n\nProgress a candidate through the hiring pipeline.\n\n## Steps\n1. Find the application — by ID, or list applications for the candidate or job.\n2. Confirm the current stage by getting the application.\n3. Change the application stage to the target stage.\n4. Add a note capturing the rationale and any interview feedback.\n\n## Output\nConfirm the candidate, the stage moved from and to, and the note added.',
    },
    {
      name: 'pipeline-status-report',
      description:
        'List candidates and applications by status or job in Ashby and summarize pipeline health. Use for recruiting standups and weekly reports.',
      content:
        '# Pipeline Status Report\n\nSummarize the state of an Ashby hiring pipeline.\n\n## Steps\n1. List the relevant jobs, or focus on one role.\n2. List applications, grouping candidates by current stage and status (active, hired, archived).\n3. Flag candidates stalled in a stage or awaiting feedback.\n4. Note new candidates added since the last report.\n\n## Output\nA pipeline summary: candidate counts per stage and status, stalled candidates called out by name and role, and recent additions.',
    },
  ],
} as const satisfies BlockMeta
