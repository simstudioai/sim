import { VantaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const VantaBlockDisplay = {
  type: 'vanta',
  name: 'Vanta',
  description: 'Query compliance status and manage evidence in Vanta',
  category: 'tools',
  bgColor: '#F8F4F3',
  icon: VantaIcon,
  longDescription:
    'Integrate Vanta into the workflow. Monitor compliance frameworks, controls, and automated tests; find failing test entities; manage evidence documents including file upload, download, and submission; and track people, policies, vendors, monitored computers, vulnerabilities, and risk scenarios. Requires Vanta OAuth client credentials.',
  docsLink: 'https://docs.sim.ai/integrations/vanta',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const VantaBlockMeta = {
  tags: ['monitoring', 'automation', 'document-processing'],
  url: 'https://www.vanta.com',
  templates: [
    {
      icon: VantaIcon,
      title: 'Vanta failing test alerts',
      prompt:
        'Create a scheduled workflow that lists Vanta tests with status NEEDS_ATTENTION each morning, fetches the failing entities for each test, and posts a remediation digest to a Slack channel.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta evidence uploader',
      prompt:
        'Build a workflow that takes a generated report file, uploads it as evidence to the matching Vanta document with a description and effective date, and then submits the document collection for review.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'document-processing'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta vulnerability SLA watcher',
      prompt:
        'Create a scheduled workflow that lists Vanta vulnerabilities with SLA deadlines in the next 7 days, groups them by severity and vulnerable asset, and emails the security team a prioritized remediation list.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta compliance status report',
      prompt:
        'Build a scheduled workflow that lists Vanta frameworks with their control and test completion counts, has an agent summarize progress and gaps per framework, and writes a weekly compliance report to a table.',
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'monitoring'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta onboarding task chaser',
      prompt:
        'Create a scheduled workflow that lists current Vanta people with overdue security tasks, and sends each person a direct Slack message listing what they still need to complete.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation', 'people'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta vendor review pipeline',
      prompt:
        'Build a scheduled workflow that lists Vanta vendors whose next security review is due within 30 days, looks up each vendor’s risk levels and contract dates, and creates a review task in the team’s project tracker.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation', 'vendor-management'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta compliance Q&A agent',
      prompt:
        'Create an agent that answers compliance questions by querying Vanta: it can look up framework progress, control status, failing tests and their entities, policy approval status, and risk scenarios, and grounds every answer in the returned data.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['agentic', 'research'],
    },
  ],
  skills: [
    {
      name: 'triage-failing-vanta-tests',
      description:
        'Find failing Vanta tests, pull their failing entities, and produce a prioritized remediation list.',
      content:
        '# Triage Failing Vanta Tests\n\nTurn the current Vanta test status into an actionable remediation list.\n\n## Steps\n1. Use List Tests with Test Status set to Needs Attention to find failing tests. Narrow with Framework ID or Integration ID if asked.\n2. For each failing test, use List Test Entities with Entity Status set to Failing to get the exact resources that fail.\n3. Read each test’s failure description and remediation description from the output to explain what is wrong and how to fix it.\n4. Group results by test category and order by the number of failing entities.\n\n## Output\nReturn a prioritized list: test name, why it fails, the failing resources, and the documented remediation steps.',
    },
    {
      name: 'upload-vanta-evidence',
      description:
        'Attach an evidence file to a Vanta document and submit the collection for review.',
      content:
        '# Upload Evidence to Vanta\n\nAttach a file to the right evidence document and make it visible to auditors.\n\n## Steps\n1. Use List Documents (filter by framework or status "Needs document" / "Needs update") to find the target document and note its ID.\n2. Use Upload Document File with the document ID, the file, a clear Description (e.g., "Q3 access review evidence"), and optionally an Effective Date.\n3. Use Submit Document with the same document ID so the evidence moves out of draft and becomes visible to auditors.\n4. Confirm with Get Document that the upload status is now OK.\n\n## Output\nReturn the uploaded file metadata and the document’s final status.',
    },
    {
      name: 'vanta-compliance-snapshot',
      description: 'Summarize framework, control, and test completion across a Vanta account.',
      content:
        '# Vanta Compliance Snapshot\n\nProduce a concise status report across all frameworks.\n\n## Steps\n1. Use List Frameworks to get every framework with its control, document, and test completion counts.\n2. For frameworks that are behind, use List Framework Controls and Get Control to find controls with failing or missing evidence.\n3. Use List Tests with Test Status set to Needs Attention to count open issues per framework.\n4. Compute completion percentages from the numeric outputs (numControlsCompleted / numControlsTotal, etc.).\n\n## Output\nReturn a per-framework table: completion percentages, failing test count, and the controls that need attention.',
    },
    {
      name: 'vanta-vulnerability-sla-report',
      description:
        'List Vanta vulnerabilities approaching their SLA deadlines with affected assets.',
      content:
        '# Vulnerabilities Approaching SLA\n\nFind what must be remediated soon and where.\n\n## Steps\n1. Use List Vulnerabilities with SLA Deadline Before set to the cutoff date (e.g., 7 days from now) and SLA Deadline After set to today.\n2. Narrow with Severity (CRITICAL or HIGH first) and Fix Available set to Yes for quick wins.\n3. For each vulnerability, use Get Vulnerable Asset with its asset ID to identify the affected server, repository, or workstation.\n4. Use List Vulnerability Remediations with Remediated On Time set to No to report recent SLA misses.\n\n## Output\nReturn vulnerabilities grouped by severity with remediate-by dates, fixed versions when available, and the affected assets.',
    },
    {
      name: 'vanta-people-task-audit',
      description: 'Find people with overdue security tasks in Vanta and what each still owes.',
      content:
        '# Audit Outstanding Security Tasks\n\nIdentify who is blocking compliance and why.\n\n## Steps\n1. Use List People with Task Summary Statuses set to OVERDUE,DUE_SOON and Employment Status set to Current.\n2. Read each person’s tasksSummary output for the due date, and use Task Types to narrow to a specific obligation (e.g., COMPLETE_TRAININGS or ACCEPT_POLICIES) when asked.\n3. Use Get Person for any individual to confirm employment, group membership, and leave status before escalating.\n\n## Output\nReturn each person’s name, email, overdue items, and due dates, ordered by how overdue they are.',
    },
  ],
} as const satisfies BlockMeta
