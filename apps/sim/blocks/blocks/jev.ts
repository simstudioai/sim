import { TypeSafeIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type {
  JevChoiceResponse,
  JevEvaluateResponse,
  JevNoulResponse,
  JevScoreResponse,
} from '@/tools/jev/types'

export const JevBlock: BlockConfig<
  JevChoiceResponse | JevScoreResponse | JevNoulResponse | JevEvaluateResponse
> = {
  type: 'jev',
  name: 'Jev',
  description: 'Make structured decisions with TypeSafe AI',
  longDescription:
    'Use TypeSafe AI’s Jev to classify content, score it against a rubric, or evaluate yes/no questions. Evaluate multiple questions against shared state in one request and route results using probabilities and confidence. Requires your own TypeSafe API key.',
  docsLink: 'https://docs.sim.ai/integrations/jev',
  category: 'tools',
  integrationType: IntegrationType.AI,
  authMode: AuthMode.ApiKey,
  bgColor: '#F386A1',
  icon: TypeSafeIcon,
  canvasPresentation: {
    defaultTitle: 'Jev',
    sentences: {
      byOperation: {
        jev_choice: [{ text: 'Choose an option for', field: 'instructions', core: true }],
        jev_score: [{ text: 'Score content for', field: 'instructions', core: true }],
        jev_noul: [{ text: 'Evaluate whether', field: 'instructions', core: true }],
        jev_evaluate: [{ text: 'Evaluate questions against', field: 'state', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Choice', id: 'jev_choice' },
        { label: 'Score', id: 'jev_score' },
        { label: 'Yes/No (Noul)', id: 'jev_noul' },
        { label: 'Evaluate Questions', id: 'jev_evaluate' },
      ],
      value: () => 'jev_choice',
    },
    {
      id: 'state',
      title: 'State',
      type: 'long-input',
      placeholder: 'Content to evaluate, or a reference to structured data',
      required: true,
    },
    {
      id: 'instructions',
      title: 'Question',
      type: 'long-input',
      placeholder: 'What should Jev decide?',
      condition: { field: 'operation', value: ['jev_choice', 'jev_score', 'jev_noul'] },
      required: true,
    },
    {
      id: 'choiceCriteria',
      title: 'Options',
      type: 'code',
      language: 'json',
      placeholder: '{"billing": "Payments and refunds", "technical": "Bugs and outages"}',
      condition: { field: 'operation', value: 'jev_choice' },
      required: true,
    },
    {
      id: 'scoreCriteria',
      title: 'Rubric',
      type: 'code',
      language: 'json',
      placeholder: '["Low", "Medium", "High"]',
      condition: { field: 'operation', value: 'jev_score' },
      required: true,
    },
    {
      id: 'noulCriteria',
      title: 'Yes/No Criteria',
      type: 'code',
      language: 'json',
      placeholder: '{"true": "Explicitly urgent", "false": "No urgency expressed"}',
      condition: { field: 'operation', value: 'jev_noul' },
      mode: 'advanced',
    },
    {
      id: 'questions',
      title: 'Questions',
      type: 'code',
      language: 'json',
      placeholder: '{"urgent": {"type": "noul", "instructions": "Is this urgent?"}}',
      condition: { field: 'operation', value: 'jev_evaluate' },
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'Jev 1.13', id: 'jev-1.13.0' },
        { label: 'Jev Latest', id: 'jev-latest' },
        { label: 'Jev Preview', id: 'jev-preview' },
      ],
      value: () => 'jev-1.13.0',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'TypeSafe API Key',
      type: 'short-input',
      placeholder: 'Enter your TypeSafe API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['jev_choice', 'jev_score', 'jev_noul', 'jev_evaluate'],
    config: {
      tool: (params) => params.operation || 'jev_choice',
      params: (params) => {
        switch (params.operation || 'jev_choice') {
          case 'jev_choice':
            return { criteria: params.choiceCriteria }
          case 'jev_score':
            return { criteria: params.scoreCriteria }
          case 'jev_noul':
            return { criteria: params.noulCriteria }
          default:
            return {}
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'TypeSafe API key' },
    state: { type: 'string', description: 'Text or a reference to structured data to evaluate' },
    instructions: { type: 'string', description: 'Question to evaluate' },
    choiceCriteria: { type: 'json', description: 'Option names mapped to descriptions' },
    scoreCriteria: { type: 'json', description: 'Ordered rubric with 2–10 levels' },
    noulCriteria: { type: 'json', description: 'Optional true and false descriptions' },
    questions: { type: 'json', description: 'Named Choice, Score, and Noul questions' },
    model: { type: 'string', description: 'Jev model ID or alias' },
  },
  outputs: {
    choice: { type: 'string', description: 'Selected option (Choice)' },
    score: { type: 'number', description: 'Probability-weighted rubric score (Score)' },
    legend: { type: 'json', description: 'Rubric descriptions by level (Score)' },
    noul: { type: 'number', description: 'Probability of yes, from 0 to 1 (Noul)' },
    probabilities: { type: 'json', description: 'Probabilities by option or level (Choice/Score)' },
    confidence: { type: 'number', description: 'Answer confidence, from 0 to 1 (Choice/Score)' },
    answers: {
      type: 'json',
      description: 'Typed answers keyed by question ID (Evaluate Questions)',
    },
    model: { type: 'string', description: 'Versioned model ID used for evaluation' },
    usage: {
      type: 'json',
      description: 'Token usage with input_tokens and output_tokens',
    },
  },
}

export const JevBlockMeta = {
  tags: ['automation'],
  url: 'https://typesafe.ai',
  templates: [
    {
      icon: TypeSafeIcon,
      title: 'Jev support ticket router',
      prompt:
        'Build a webhook workflow that classifies incoming support tickets with Jev Choice, branches by the selected team, and writes uncertain tickets to a human-review table.',
      modules: ['workflows', 'tables'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: TypeSafeIcon,
      title: 'Jev urgency scorer',
      prompt:
        'When a support ticket arrives by webhook, use Jev Score with an ordered urgency rubric and store the score and confidence in a triage table.',
      modules: ['workflows', 'tables'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: TypeSafeIcon,
      title: 'Jev message guardrail',
      prompt:
        'Before an agent processes an incoming message, evaluate policy-specific Noul questions with Jev and route flagged or uncertain messages to a review table.',
      modules: ['agent', 'workflows', 'tables'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: TypeSafeIcon,
      title: 'Jev citation checker',
      prompt:
        'For each submitted claim and source passage, use Jev Choice to classify whether the source supports the claim, then store the answer and confidence in a review table.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['research', 'automation'],
    },
    {
      icon: TypeSafeIcon,
      title: 'Jev retrieval filter',
      prompt:
        'After a knowledge-base search, use Jev to classify each retrieved passage for relevance and contradiction, then pass suitable passages to an answering agent and store the decisions.',
      modules: ['knowledge-base', 'agent', 'workflows', 'tables'],
      category: 'engineering',
      tags: ['research', 'automation'],
    },
    {
      icon: TypeSafeIcon,
      title: 'Jev duplicate record review',
      prompt:
        'On a schedule, read candidate duplicate record pairs from a table, use Jev Score to rate whether they describe the same entity, and write merge, keep, or review recommendations back to the table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'sync'],
    },
    {
      icon: TypeSafeIcon,
      title: 'Jev multi-question triage',
      prompt:
        'When a customer message arrives by webhook, evaluate intent, urgency, and escalation questions together with Jev and write the answers and confidence values into a triage table.',
      modules: ['workflows', 'tables'],
      category: 'support',
      tags: ['support', 'automation'],
    },
  ],
  skills: [
    {
      name: 'classify-support-intent',
      description: 'Classify a support request and report when confidence calls for human review.',
      content:
        '# Classify Support Intent\n\nUse Jev Choice with the supplied support message as state and explicit team descriptions as criteria. Return the selected team, probabilities, and confidence. Apply the user’s review threshold; do not silently act on uncertain decisions.\n\nSource: https://docs.typesafe.ai/patterns/intent-routing',
    },
    {
      name: 'score-ticket-urgency',
      description: 'Rate support-ticket urgency against an explicit ordered rubric.',
      content:
        '# Score Ticket Urgency\n\nUse Jev Score with the ticket as state and 2–10 ordered urgency descriptions. Return the probability-weighted score, legend, probabilities, and confidence. Keep the fractional score intact.\n\nSource: https://docs.typesafe.ai/api',
    },
    {
      name: 'evaluate-message-policy',
      description: 'Evaluate a message against a set of explicit policy questions.',
      content:
        '# Evaluate Message Policy\n\nUse Jev Evaluate with the message as state and one Noul question per policy condition. Return each probability and apply only user-supplied thresholds. Flag uncertain results for review.\n\nSource: https://docs.typesafe.ai/cookbooks/llm_guardrails',
    },
    {
      name: 'check-citation-support',
      description: 'Check whether a source passage supports a supplied claim.',
      content:
        '# Check Citation Support\n\nPut the supplied claim and source passage in Jev state. Use Choice to distinguish supported, contradicted, and insufficient evidence. Return the choice, probabilities, and confidence without adding unsupported facts.\n\nSource: https://docs.typesafe.ai/cookbooks/citation_check',
    },
    {
      name: 'classify-retrieved-passages',
      description: 'Assess supplied retrieval passages before using them to answer a question.',
      content:
        '# Classify Retrieved Passages\n\nUse Jev Evaluate to ask independent relevance and contradiction questions about supplied passages and a query. Return per-passage decisions, probabilities, and confidence where provided. Leave retention thresholds under user control.\n\nSource: https://docs.typesafe.ai/cookbooks/classifying_rag_passages',
    },
  ],
} as const satisfies BlockMeta
