import { DaytonaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DaytonaBlockDisplay = {
  type: 'daytona',
  name: 'Daytona',
  description: 'Run code and commands in secure cloud sandboxes',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DaytonaIcon,
  longDescription:
    'Integrate Daytona into your workflow to run AI-generated code in secure, isolated sandboxes. Create and manage sandboxes, execute shell commands, run Python, JavaScript, or TypeScript code, transfer files, and clone Git repositories.',
  docsLink: 'https://docs.sim.ai/integrations/daytona',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const DaytonaBlockMeta = {
  tags: ['agentic', 'cloud', 'automation'],
  url: 'https://www.daytona.io',
  templates: [
    {
      icon: DaytonaIcon,
      title: 'Daytona code interpreter',
      prompt:
        'Build a workflow where an agent answers data questions by writing Python, creating a Daytona sandbox, running the code in it, and replying with the computed result and any printed output.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'code-execution'],
    },
    {
      icon: DaytonaIcon,
      title: 'Daytona PR test runner',
      prompt:
        'Create a workflow triggered by a GitHub pull request that creates a Daytona sandbox, clones the repository at the PR branch, runs the test suite with an execute command, and posts the pass/fail summary back to the PR.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['ci', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: DaytonaIcon,
      title: 'Daytona CSV analysis',
      prompt:
        'Build a workflow that takes an uploaded CSV file, uploads it into a Daytona sandbox, runs a Python analysis script over it, downloads the generated report file, and shares the findings in Slack.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['data', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DaytonaIcon,
      title: 'Daytona scheduled script runner',
      prompt:
        'Create a scheduled daily workflow that spins up a Daytona sandbox, runs a maintenance script with an execute command, writes the output to a results table, and deletes the sandbox when finished.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'maintenance'],
    },
    {
      icon: DaytonaIcon,
      title: 'Daytona sandbox janitor',
      prompt:
        'Build a scheduled weekly workflow that lists all Daytona sandboxes, stops any that have been running longer than expected, deletes sandboxes labeled as temporary, and posts a cleanup summary to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cost-control'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DaytonaIcon,
      title: 'Daytona generated-code validator',
      prompt:
        'Create a workflow where an agent generates code from a user request, runs it in a Daytona sandbox, inspects the exit code and output, fixes errors and reruns until the code passes, then returns the validated code.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'code-execution'],
    },
    {
      icon: DaytonaIcon,
      title: 'Daytona repo health check',
      prompt:
        'Build a scheduled workflow that creates a Daytona sandbox, clones the main branch of a repository, runs install and build commands, records any failures in a table, and alerts the engineering channel when the build breaks.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['ci', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DaytonaIcon,
      title: 'Daytona file transformer',
      prompt:
        'Create a workflow that receives a document from a form, uploads it to a Daytona sandbox, runs a conversion script on it, downloads the transformed file, and emails it back to the requester.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'documents'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'run-code-in-sandbox',
      description:
        'Run Python, JavaScript, or TypeScript in an isolated Daytona sandbox and return the output. Use as a safe code interpreter for computation, parsing, or data wrangling.',
      content:
        '# Run Code In Sandbox\n\nExecute code safely in an isolated Daytona sandbox.\n\n## Steps\n1. Create a sandbox with the Create Sandbox operation (or reuse an existing sandbox ID), setting an auto-stop interval so it cleans up after itself.\n2. Use Run Code with the language set to python, javascript, or typescript. Print the values you need to stdout — the printed output is what comes back.\n3. Check the exit code: 0 means success; on failure, read the result output for the error, fix the code, and rerun.\n4. Delete the sandbox with Delete Sandbox when the work is finished if it was created just for this task.\n\n## Output\nReturn the printed result and the exit code. If the run produced chart artifacts, mention them. On repeated failures, return the last error output instead of fabricating a result.',
    },
    {
      name: 'analyze-data-file',
      description:
        'Upload a data file into a Daytona sandbox, analyze it with Python, and download any generated results. Use for CSV/JSON analysis that needs real computation.',
      content:
        '# Analyze Data File\n\nProcess a workflow file with real code in a sandbox.\n\n## Steps\n1. Create a sandbox (or reuse one) and note its ID.\n2. Use Upload File to place the data file at a known path, e.g. /home/daytona/data.csv. A trailing slash on the destination uploads into that directory under the original file name.\n3. Use Run Code with Python to read the file from that path, compute the analysis, print a summary, and write any derived files (reports, charts) to known paths.\n4. Use Download File to pull each derived file back into the workflow, and List Files to discover outputs if paths are dynamic.\n5. Delete the sandbox when finished.\n\n## Output\nReturn the printed analysis summary and the downloaded result files. Name the exact sandbox paths used so the run can be reproduced.',
    },
    {
      name: 'clone-repo-and-run-checks',
      description:
        'Clone a Git repository into a Daytona sandbox and run install, build, or test commands. Use for CI-style checks, repo health monitoring, or validating changes.',
      content:
        '# Clone Repo And Run Checks\n\nRun repository checks in an isolated environment.\n\n## Steps\n1. Create a sandbox sized for the job (set CPU and memory in advanced options for heavy builds).\n2. Use Git Clone with the repository URL and a clone path like /home/daytona/repo. Pass a branch for non-default branches, and a username plus token for private repositories.\n3. Use Execute Command from the clone path (set the working directory) to run installs, builds, or tests. Raise the timeout for long commands — the default is 10 seconds.\n4. Inspect each exit code and capture the output of failing commands.\n5. Delete the sandbox when the checks complete.\n\n## Output\nReturn pass/fail per command with exit codes, and include the failing output verbatim when something breaks.',
    },
    {
      name: 'manage-sandbox-fleet',
      description:
        'List, stop, and delete Daytona sandboxes to control cost and tidy up environments. Use for scheduled cleanup or auditing what is currently running.',
      content:
        '# Manage Sandbox Fleet\n\nAudit and clean up sandboxes in the organization.\n\n## Steps\n1. Use List Sandboxes to enumerate sandboxes; filter by name prefix or labels, and page with the cursor when there are many.\n2. Inspect each sandbox state and timestamps to find ones idle or running longer than expected.\n3. Stop Sandbox for environments worth keeping but not actively used; Delete Sandbox for disposable ones (e.g. labeled temporary).\n4. When creating sandboxes elsewhere, set auto-stop and auto-delete intervals so cleanup happens automatically.\n\n## Output\nReturn a summary of sandboxes found, which were stopped or deleted and why, and any that were left running with their states.',
    },
  ],
} as const satisfies BlockMeta
