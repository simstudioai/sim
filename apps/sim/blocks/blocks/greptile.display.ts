import { ClipboardList } from '@/components/emcn/icons'
import { GreptileIcon, SlackIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GreptileBlockDisplay = {
  type: 'greptile',
  name: 'Greptile',
  description: 'AI-powered codebase search and Q&A',
  category: 'tools',
  bgColor: '#181C1E',
  icon: GreptileIcon,
  longDescription:
    'Query and search codebases using natural language with Greptile. Get AI-generated answers about your code, find relevant files, and understand complex codebases.',
  docsLink: 'https://docs.sim.ai/integrations/greptile',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const GreptileBlockMeta = {
  tags: ['version-control', 'knowledge-base'],
  url: 'https://www.greptile.com',
  templates: [
    {
      icon: SlackIcon,
      title: 'Slack code Q&A bot',
      prompt:
        'Build a workflow that monitors a Slack channel for code questions, routes them to Greptile against the relevant repository, and replies in-thread with the answer and the cited files.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GreptileIcon,
      title: 'Onboarding codebase explainer',
      prompt:
        'Create a workflow where a new engineer asks how a part of the codebase works, Greptile answers against the indexed repository with cited files, and the explanation is saved to a Google Doc.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'onboarding'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: ClipboardList,
      title: 'PR review with codebase context',
      prompt:
        'Build a workflow that takes a pull request, asks Greptile how the changed code interacts with the rest of the repository, and writes a review comment summarizing impact and risks with cited files.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'code-review'],
      alsoIntegrations: ['github'],
    },
  ],
  skills: [
    {
      name: 'answer-codebase-question',
      description:
        'Ask Greptile a natural-language question about an indexed repository and return a cited answer.',
      content:
        '# Answer Codebase Question\n\nGet an accurate, source-cited answer about how a codebase works.\n\n## Steps\n1. Confirm the repository is indexed by checking its index status; if not ready, index it first and wait.\n2. Query Greptile with the natural-language question (e.g. how authentication flows, where payments are processed).\n3. Capture the answer along with the file and function references it cites.\n4. If the answer is vague, refine the question with more specifics and re-query.\n\n## Output\nReturn the answer plus a list of cited files and symbols. Useful for onboarding, debugging, and understanding unfamiliar code.',
    },
    {
      name: 'review-pull-request',
      description:
        'Use Greptile to assess how a PR diff interacts with the rest of the repo and draft review notes.',
      content:
        '# Review Pull Request\n\nProduce a codebase-aware review of a set of changes.\n\n## Steps\n1. Ensure the repository is indexed (check status, index if needed).\n2. Query Greptile describing the changed files and ask how they interact with the rest of the codebase, what might break, and what edge cases to test.\n3. Collect the impact analysis and the cited files affected beyond the diff.\n4. Organize findings into bugs/risks, style/consistency, and suggested tests.\n\n## Output\nReturn structured review notes grouped by severity, each with the cited file and a concrete suggestion. Ready to post as a PR comment.',
    },
    {
      name: 'index-and-verify-repo',
      description:
        'Trigger Greptile indexing for a repository and poll until it is ready to query.',
      content:
        '# Index and Verify Repo\n\nMake a repository queryable in Greptile.\n\n## Steps\n1. Start indexing for the repository, specifying the remote, owner/repo, and branch.\n2. Poll the index status until it reports completed or fails.\n3. On failure, report the error and the branch/remote used so it can be corrected.\n4. On success, run a quick sanity query to confirm answers come back with citations.\n\n## Output\nReturn the final index status, the branch indexed, and the result of the sanity query. Confirms the repo is ready for codebase questions and reviews.',
    },
  ],
} as const satisfies BlockMeta
