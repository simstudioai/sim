import { BrowserUseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const BrowserUseBlockDisplay = {
  type: 'browser_use',
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  category: 'tools',
  bgColor: '#181C1E',
  icon: BrowserUseIcon,
  longDescription:
    'Integrate Browser Use into the workflow. Can navigate the web and perform actions as if a real user was interacting with the browser.',
  docsLink: 'https://docs.sim.ai/integrations/browser_use',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const BrowserUseBlockMeta = {
  tags: ['web-scraping', 'automation', 'agentic'],
  url: 'https://browser-use.com',
  templates: [
    {
      icon: BrowserUseIcon,
      title: 'Browser Use form filler',
      prompt:
        'Build a workflow that uses Browser Use to automate filling complex web forms — vendor portals, compliance questionnaires — with data pulled from a table, and captures screenshots to a file as audit trail.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use competitor pricing scraper',
      prompt:
        'Create a scheduled workflow that runs Browser Use weekly to navigate competitor pricing pages, captures the current plans and prices, diffs against last week, and posts changes to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use legacy ERP scraper',
      prompt:
        'Create a workflow that uses Browser Use to log into a legacy ERP without an API, exports daily reports, parses them into a table, and posts a summary to Slack so old systems still feed modern ops.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use + Stagehand cross-tool QA',
      prompt:
        'Create a workflow that uses Browser Use and Stagehand together to run scripted browser flows against staging, captures screenshots, and writes a regression report.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['stagehand'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use + Stagehand expense-portal grabber',
      prompt:
        'Build a workflow that uses Browser Use and Stagehand to automate expense-portal data pulls from suppliers, captures the structured data, and writes to a finance table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['stagehand'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use invoice-portal collector',
      prompt:
        'Create a workflow that uses Browser Use to log into vendor invoice portals weekly, downloads outstanding invoices, and writes the metadata to a finance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use review-site monitor',
      prompt:
        'Build a workflow that uses Browser Use to scrape G2 and Capterra review pages for brand mentions, classifies sentiment, and writes notable reviews to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'automate-web-task',
      description:
        'Drive a browser agent to complete a multi-step task on a website, like navigating, clicking, and submitting. Use when a site has no API and a human would normally do the clicks.',
      content:
        '# Automate Web Task\n\nHave the browser agent perform a goal-oriented task on the web.\n\n## Steps\n1. Write a clear, step-by-step Task describing the goal and any success condition (e.g. "log in, open Billing, download the latest invoice").\n2. Set the Start URL so the agent begins on the right page.\n3. Put any credentials or sensitive inputs in Variables (Secrets) and reference them in the task by name rather than pasting them inline.\n4. Restrict Allowed Domains to keep the agent on the intended site, and raise Max Steps for longer flows.\n\n## Output\nReturn whether the task succeeded, the final output, and the share URL for the recorded session so the run can be audited. If the agent gets stuck, report the last step and what blocked it.',
    },
    {
      name: 'extract-structured-data-from-site',
      description:
        'Use a browser agent to navigate a site and return data in a defined JSON schema. Use to pull structured records (prices, listings, table rows) from pages without an API.',
      content:
        '# Extract Structured Data From Site\n\nNavigate a website and return structured data.\n\n## Steps\n1. Write a Task that tells the agent what to find and where (e.g. "go to the pricing page and collect every plan name and monthly price").\n2. Set the Start URL and limit Allowed Domains to the target site.\n3. Provide a Structured Output Schema (stringified JSON schema) describing the exact fields you want back.\n4. Run it; the agent fills the schema from what it observes on the page.\n\n## Output\nReturn the data as objects matching the provided schema. Confirm each field was actually found on the page; if a field could not be located, leave it null and note it rather than fabricating a value.',
    },
    {
      name: 'fill-and-submit-form',
      description:
        'Have a browser agent fill out and submit a web form using supplied field values. Use for vendor portals, questionnaires, or applications that have no API.',
      content:
        '# Fill And Submit Form\n\nComplete a web form end to end.\n\n## Steps\n1. Describe the form and the mapping of values to fields in the Task (e.g. "fill the contact form: name, company, message, then submit").\n2. Set the Start URL to the form page and constrain Allowed Domains.\n3. Pass any private values through Variables (Secrets) so they are injected securely.\n4. Ask the agent to confirm the submission succeeded (look for a success message or confirmation page) before finishing.\n\n## Output\nReturn whether the form submitted successfully, any confirmation text or reference number shown, and the session share URL as an audit trail. If a required field was missing or validation failed, report which field and why.',
    },
  ],
} as const satisfies BlockMeta
