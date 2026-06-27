import { RipplingIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RipplingBlockDisplay = {
  type: 'rippling',
  name: 'Rippling',
  description: 'Manage workers, departments, custom objects, and company data in Rippling',
  category: 'tools',
  bgColor: '#502D3C',
  icon: RipplingIcon,
  longDescription:
    'Integrate Rippling Platform into your workflow. Manage workers, users, departments, teams, titles, work locations, business partners, supergroups, custom objects, custom apps, custom pages, custom settings, object categories, reports, and draft hires.',
  docsLink: 'https://docs.sim.ai/integrations/rippling',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay

export const RipplingBlockMeta = {
  tags: ['hiring'],
  url: 'https://www.rippling.com',
  templates: [
    {
      icon: RipplingIcon,
      title: 'Rippling new-hire provisioning',
      prompt:
        'Build a scheduled workflow that polls Rippling for new workers, creates accounts in the matching downstream tools, drops each new hire into the right Slack channels, books day-one onboarding via Google Calendar, and writes provisioning status to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'team'],
      alsoIntegrations: ['slack', 'google_calendar'],
    },
    {
      icon: RipplingIcon,
      title: 'Rippling departure offboarder',
      prompt:
        'Create a scheduled workflow that polls Rippling for workers transitioning out, gathers their owned resources, deactivates downstream accounts, schedules data handoff meetings, posts a structured offboarding checklist to a table, and notifies the people team in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'compliance'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RipplingIcon,
      title: 'Org chart export and review',
      prompt:
        'Build a scheduled weekly workflow that pulls Rippling workers, departments, teams, and titles, writes an updated org chart file, diffs against last week to find structural changes, and Slacks people operations any unexpected moves for review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RipplingIcon,
      title: 'Custom object data sync',
      prompt:
        'Create a workflow that reads rows from a Sim table representing custom Rippling objects — perks, equipment, allowances — and upserts them into Rippling so HR can manage company-specific data with the same governance as core worker records.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'sync', 'automation'],
    },
    {
      icon: RipplingIcon,
      title: 'Team and title auditor',
      prompt:
        'Build a scheduled monthly workflow that lists Rippling teams, titles, and job functions, flags duplicates, unused values, and inconsistent naming, writes a cleanup report file, and opens a Linear task for the people operations owner of each issue.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'analysis'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: RipplingIcon,
      title: 'Manager change notifier',
      prompt:
        'Create a scheduled workflow that polls Rippling workers for manager reassignments, notifies the worker and the new manager via email, schedules a thirty-minute intro on Google Calendar, and logs the transition in a tracking table for HR visibility.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'team', 'communication'],
      alsoIntegrations: ['gmail', 'google_calendar'],
    },
    {
      icon: RipplingIcon,
      title: 'Department headcount digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Rippling workers grouped by department and employment type, computes headcount, open requisitions, and growth versus the prior week, writes a narrative summary, and emails it to department heads.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'reporting', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'lookup-employee-profile',
      description: 'Find a Rippling worker and return their role, department, and team details.',
      content:
        '# Lookup Employee Profile\n\nRetrieve a complete profile for an employee.\n\n## Steps\n1. Run list_workers filtered by name or attributes to find the worker, or list_users if you have a user id.\n2. Run get_worker for the full record once identified.\n3. Enrich with get_department, get_team, and get_title as needed for context.\n4. Assemble the profile.\n\n## Output\nReturn the worker name, title, department, team, and employment type. Note any field that is unavailable.',
    },
    {
      name: 'department-headcount-report',
      description: 'Group Rippling workers by department and employment type to report headcount.',
      content:
        '# Department Headcount Report\n\nBuild a headcount snapshot across the org.\n\n## Steps\n1. Run list_departments to enumerate departments.\n2. Run list_workers and group by department and employment type.\n3. Compute headcount per group and compare against a prior snapshot for growth.\n4. Write a narrative summary of the changes.\n\n## Output\nReturn headcount per department and employment type, plus week-over-week change where available.',
    },
    {
      name: 'manage-department',
      description: 'Create or update a department record in Rippling for an org change.',
      content:
        '# Manage Department\n\nKeep the Rippling org structure current.\n\n## Steps\n1. Run list_departments to check whether the department already exists.\n2. If new, run create_department with the name and parent details.\n3. If it exists, run update_department to adjust the record.\n4. Confirm with get_department.\n\n## Output\nReturn the department id and whether it was created or updated.',
    },
    {
      name: 'sync-custom-object-records',
      description:
        'Push external data (training, licenses, assets) onto Rippling custom object records.',
      content:
        '# Sync Custom Object Records\n\nWrite product data onto Rippling profiles via custom objects.\n\n## Steps\n1. Run list_custom_objects to find the target object, then list_custom_object_fields to confirm its schema.\n2. Build the records to write (for example training completion dates, license assignments, or asset ids).\n3. Use create_custom_object_record or update_custom_object_record for single writes, or bulk_create_custom_object_records and bulk_update_custom_object_records for batches.\n4. Verify with query_custom_object_records or get_custom_object_record_by_external_id.\n\n## Output\nReturn the count of records created or updated and flag any that failed validation.',
    },
    {
      name: 'run-rippling-report',
      description: 'Trigger a Rippling report run and retrieve the completed results.',
      content:
        '# Run Rippling Report\n\nGenerate and collect a Rippling report for downstream analysis.\n\n## Steps\n1. Run trigger_report_run for the target report id to start a run.\n2. Capture the returned run id.\n3. Poll get_report_run until the run completes.\n4. Pass the results downstream to a table or summary.\n\n## Output\nReturn the report run id, completion status, and a summary of the returned rows.',
    },
  ],
} as const satisfies BlockMeta
