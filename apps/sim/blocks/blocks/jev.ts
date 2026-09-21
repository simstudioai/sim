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
      wandConfig: {
        enabled: true,
        prompt:
          'Create Jev Choice options from the user request. Return an object with 1–255 option names mapped to clear descriptions, for example {"billing":"Payments and refunds","technical":"Bugs and outages"}. Return ONLY the JSON object.',
        placeholder: 'Describe the categories Jev should choose between...',
        generationType: 'json-object',
      },
    },
    {
      id: 'scoreCriteria',
      title: 'Rubric',
      type: 'code',
      language: 'json',
      placeholder: '["Low", "Medium", "High"]',
      condition: { field: 'operation', value: 'jev_score' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Create an ordered Jev Score rubric with 2–10 level descriptions, from lowest to highest, for example ["Low","Medium","High"]. Return ONLY the JSON array.',
        placeholder: 'Describe what to score and the levels to use...',
        generationType: 'json-array',
      },
    },
    {
      id: 'noulCriteria',
      title: 'Yes/No Criteria',
      type: 'code',
      language: 'json',
      placeholder: '{"true": "Explicitly urgent", "false": "No urgency expressed"}',
      condition: { field: 'operation', value: 'jev_noul' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Define the meaning of yes and no for a Jev Noul question using true and false keys, for example {"true":"Explicitly urgent","false":"No urgency expressed"}. Return ONLY the JSON object.',
        placeholder: 'Describe what should count as yes or no...',
        generationType: 'json-object',
      },
    },
    {
      id: 'questions',
      title: 'Questions',
      type: 'code',
      language: 'json',
      placeholder: '{"urgent": {"type": "noul", "instructions": "Is this urgent?"}}',
      condition: { field: 'operation', value: 'jev_evaluate' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Create named Jev questions as an object keyed by question ID. Each question requires type and instructions. Choice uses type "choice" and criteria with 1–255 named options; Score uses type "score" and criteria with 2–10 ordered levels; Noul uses type "noul" and optional true/false criteria. Example: {"urgent":{"type":"noul","instructions":"Is this urgent?"}}. Return ONLY the JSON object.',
        placeholder: 'Describe the decisions to evaluate together...',
        generationType: 'json-object',
      },
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
        '# Classify Support Intent\n\n## Steps\n1. Use the supplied support message as state.\n2. Call Jev Choice with explicit team descriptions as criteria.\n3. Apply the user’s confidence threshold for human review.\n\n## Output\nReturn the selected team, probabilities, confidence, and whether review is needed. Do not silently act on uncertain decisions.\n\nSource: https://docs.typesafe.ai/patterns/intent-routing',
    },
    {
      name: 'score-ticket-urgency',
      description: 'Rate support-ticket urgency against an explicit ordered rubric.',
      content:
        '# Score Ticket Urgency\n\n## Steps\n1. Use the supplied ticket as state.\n2. Define 2–10 ordered urgency descriptions.\n3. Call Jev Score with that rubric.\n\n## Output\nReturn the probability-weighted score, legend, probabilities, and confidence. Keep the fractional score intact.\n\nSource: https://docs.typesafe.ai/api',
    },
    {
      name: 'evaluate-message-policy',
      description: 'Evaluate a message against a set of explicit policy questions.',
      content:
        '# Evaluate Message Policy\n\n## Steps\n1. Use the supplied message as state.\n2. Define one Noul question per policy condition.\n3. Call Jev Evaluate and apply only user-supplied thresholds.\n\n## Output\nReturn each probability and flag uncertain results for review.\n\nSource: https://docs.typesafe.ai/cookbooks/llm_guardrails',
    },
    {
      name: 'check-citation-support',
      description: 'Check whether a source passage supports a supplied claim.',
      content:
        '# Check Citation Support\n\n## Steps\n1. Put the supplied claim and source passage in Jev state.\n2. Define supported, contradicted, and insufficient-evidence options.\n3. Call Jev Choice to evaluate the claim against the passage.\n\n## Output\nReturn the choice, probabilities, and confidence without adding unsupported facts.\n\nSource: https://docs.typesafe.ai/cookbooks/citation_check',
    },
    {
      name: 'classify-retrieved-passages',
      description: 'Assess supplied retrieval passages before using them to answer a question.',
      content:
        '# Classify Retrieved Passages\n\n## Steps\n1. Put the supplied passages and query in Jev state.\n2. Define independent relevance and contradiction questions for each passage.\n3. Call Jev Evaluate and apply the user’s retention thresholds.\n\n## Output\nReturn per-passage decisions, probabilities, and confidence where provided. Leave retention thresholds under user control.\n\nSource: https://docs.typesafe.ai/cookbooks/classifying_rag_passages',
    },
  ],
} as const satisfies BlockMeta
