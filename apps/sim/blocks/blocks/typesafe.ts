import { ApiIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { TypeSafeResponse } from '@/tools/typesafe/types'

export const TypeSafeBlock: BlockConfig<TypeSafeResponse> = {
  type: 'typesafe',
  name: 'TypeSafe (Jev)',
  description: 'Classify, score, and evaluate input with Jev',
  longDescription:
    'Use TypeSafe Jev to choose an option, assign a fractional score, estimate a yes/no probability, or evaluate independent named questions in one request. Supply text or structured state, define criteria, and route results through downstream Condition blocks. All four operations are also available as Agent tools.',
  docsLink: 'https://docs.sim.ai/integrations/typesafe',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#343A40',
  icon: ApiIcon,
  canvasPresentation: {
    defaultTitle: 'TypeSafe (Jev)',
    sentences: {
      byOperation: {
        typesafe_choice: [{ text: 'Choose an option for', field: 'state', core: true }],
        typesafe_score: [{ text: 'Score', field: 'state', core: true }],
        typesafe_noul: [
          { text: 'Estimate the yes probability for', field: 'instructions', core: true },
        ],
        typesafe_evaluate: [{ text: 'Evaluate named questions about', field: 'state', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { id: 'typesafe_choice', label: 'Choose an Option' },
        { id: 'typesafe_score', label: 'Assign a Score' },
        { id: 'typesafe_noul', label: 'Estimate Yes/No Probability' },
        { id: 'typesafe_evaluate', label: 'Evaluate Questions' },
      ],
      value: () => 'typesafe_choice',
    },
    {
      id: 'state',
      title: 'Input / State',
      type: 'long-input',
      required: true,
      placeholder: 'Paste text, a JSON object or array, or reference an upstream output',
      description:
        'The content shared by all questions. For example, a support ticket or a claim with its source text.',
    },
    {
      id: 'instructions',
      title: 'Question',
      type: 'long-input',
      required: true,
      condition: {
        field: 'operation',
        value: ['typesafe_choice', 'typesafe_score', 'typesafe_noul'],
      },
      placeholder:
        'Which team should respond? / How urgent is this ticket? / Does the source support the claim?',
      description:
        'Choice: Which team should handle this ticket? Score: How urgent is this ticket? Noul: Does the source support the claim?',
    },
    {
      id: 'choiceCriteria',
      title: 'Criteria',
      type: 'code',
      language: 'json',
      required: true,
      condition: { field: 'operation', value: 'typesafe_choice' },
      placeholder: '{"billing":"Invoices and payments","technical":"Product problems"}',
      description:
        'An object of 1–255 named options. Descriptions may be text, structured JSON, or null.',
    },
    {
      id: 'scoreCriteria',
      title: 'Criteria',
      type: 'code',
      language: 'json',
      required: true,
      condition: { field: 'operation', value: 'typesafe_score' },
      placeholder: '["Routine","Time sensitive","Service unavailable"]',
      description:
        'An ordered array of 2–10 rubric levels indexed from zero. Descriptions may be text, structured JSON, or null.',
    },
    {
      id: 'noulCriteria',
      title: 'Criteria',
      type: 'code',
      language: 'json',
      condition: { field: 'operation', value: 'typesafe_noul' },
      placeholder:
        '{"true":"The source supports the claim","false":"The source does not support the claim"}',
      description:
        'Optional true and false descriptions as text, structured JSON, or null. Leave blank to use only the question.',
    },
    {
      id: 'questions',
      title: 'Questions',
      type: 'code',
      language: 'json',
      required: true,
      condition: { field: 'operation', value: 'typesafe_evaluate' },
      placeholder:
        '{\n  "team": {"type":"choice","instructions":"Which team should respond?","criteria":{"billing":"Invoices","technical":"Product issues"}},\n  "urgency": {"type":"score","instructions":"How urgent is the ticket?","criteria":["Routine","Urgent","Critical"]},\n  "needs_reply": {"type":"noul","instructions":"Does the customer need a reply?"}\n}',
      description:
        'A nonempty map of named choice, score, or noul questions. Each question runs independently against the same state. Instructions may be omitted, null, text, or structured JSON. Answers keep these question IDs.',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      required: true,
      placeholder: 'Enter your TypeSafe API key',
      description: 'Create an API key at console.typesafe.ai.',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      mode: 'advanced',
      defaultValue: 'jev-latest',
      placeholder: 'Select or enter a model ID',
      options: [
        { id: 'jev-latest', label: 'jev-latest' },
        { id: 'jev-preview', label: 'jev-preview' },
        { id: 'jev-1.13.0', label: 'jev-1.13.0' },
      ],
      description:
        'Defaults to jev-latest. Enter a versioned ID to pin the model; aliases may change over time.',
    },
  ],
  tools: {
    access: ['typesafe_choice', 'typesafe_evaluate', 'typesafe_noul', 'typesafe_score'],
    config: {
      params: (params) => {
        switch (params.operation) {
          case 'typesafe_score':
            return { criteria: params.scoreCriteria }
          case 'typesafe_noul':
            return { criteria: params.noulCriteria }
          case 'typesafe_evaluate':
            return {}
          default:
            return { criteria: params.choiceCriteria }
        }
      },
      tool: (params) => {
        switch (params.operation) {
          case 'typesafe_evaluate':
            return 'typesafe_evaluate'
          case 'typesafe_noul':
            return 'typesafe_noul'
          case 'typesafe_score':
            return 'typesafe_score'
          default:
            return 'typesafe_choice'
        }
      },
    },
  },
  inputs: {
    state: { type: 'string', description: 'Text or structured input to evaluate' },
    instructions: {
      type: 'string',
      description: 'Question instructions for a convenience operation',
    },
    choiceCriteria: { type: 'json', description: 'Choice options mapped to descriptions' },
    scoreCriteria: { type: 'json', description: 'Ordered Score rubric descriptions' },
    noulCriteria: { type: 'json', description: 'Optional Noul true and false descriptions' },
    questions: { type: 'json', description: 'Named questions for Evaluate Questions' },
    apiKey: { type: 'string', description: 'TypeSafe API key' },
    model: { type: 'string', description: 'Model ID or alias' },
  },
  outputs: {
    choice: {
      type: 'string',
      description: 'Selected option name',
      condition: { field: 'operation', value: 'typesafe_choice' },
    },
    score: {
      type: 'number',
      description: 'Expected score on the zero-indexed rubric; may be fractional',
      condition: { field: 'operation', value: 'typesafe_score' },
    },
    legend: {
      type: 'json',
      description: 'Score indices mapped to text, structured, or null rubric descriptions',
      condition: { field: 'operation', value: 'typesafe_score' },
    },
    probabilities: {
      type: 'json',
      description: 'Dynamic map of option names or score indices to probabilities from 0 to 1',
      condition: { field: 'operation', value: ['typesafe_choice', 'typesafe_score'] },
    },
    confidence: {
      type: 'number',
      description: 'Distribution-based confidence from 0 to 1; not a guarantee of correctness',
      condition: { field: 'operation', value: ['typesafe_choice', 'typesafe_score'] },
    },
    noul: {
      type: 'number',
      description: 'Probability of yes from 0 to 1; use a Condition block to apply a threshold',
      condition: { field: 'operation', value: 'typesafe_noul' },
    },
    answers: {
      type: 'json',
      description:
        'Answers keyed by your question IDs, each retaining its type and operation-specific fields',
      condition: { field: 'operation', value: 'typesafe_evaluate' },
    },
    model: { type: 'string', description: 'Resolved model ID returned by TypeSafe' },
    usage: { type: 'json', description: 'Request token usage: input_tokens and output_tokens' },
  },
}

export const TypeSafeBlockMeta = {
  tags: ['automation', 'llm', 'customer-support', 'document-processing'],
  url: 'https://typesafe.ai',
  templates: [
    {
      icon: ApiIcon,
      title: 'TypeSafe support ticket routing',
      prompt:
        'Build a workflow that accepts a support ticket, uses TypeSafe Choose an Option with billing, technical, and account criteria, then routes the selected choice through a Condition block. Send low-confidence decisions to a review branch and retain the probabilities.',
      modules: ['workflows'],
      category: 'support',
      tags: ['routing', 'automation', 'support'],
    },
    {
      icon: ApiIcon,
      title: 'TypeSafe ticket urgency scoring',
      prompt:
        'Build a workflow that reads support tickets from a table and uses TypeSafe Assign a Score with five ordered urgency descriptions. Store each fractional score, confidence, and rubric, then use a Condition block with a configurable escalation threshold.',
      modules: ['tables', 'workflows'],
      category: 'support',
      tags: ['scoring', 'support', 'automation'],
    },
    {
      icon: ApiIcon,
      title: 'TypeSafe LLM content screening',
      prompt:
        'Create a workflow that passes an Agent response and policy text to TypeSafe Evaluate Questions. Ask independent Noul questions about policy violations and sensitive-data disclosure. Apply configurable probability thresholds in a Condition block to allow the response or send it for review.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['guardrails', 'llm', 'review'],
    },
    {
      icon: ApiIcon,
      title: 'TypeSafe citation verification',
      prompt:
        'Build a workflow that accepts claims and their source passages, uses TypeSafe Evaluate Questions with one independent Noul question per claim about source support, and writes the support probabilities to a table. Route uncertain claims for review using configurable thresholds.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['citations', 'verification', 'research'],
    },
    {
      icon: ApiIcon,
      title: 'TypeSafe RAG passage classification',
      prompt:
        'Build a workflow that retrieves knowledge-base passages for a query and classifies each with TypeSafe Choose an Option as relevant, partially relevant, or irrelevant using explicit criteria. Keep the labels and probabilities, then pass selected passages to an Agent.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'operations',
      tags: ['rag', 'classification', 'research'],
    },
    {
      icon: ApiIcon,
      title: 'TypeSafe entity matching',
      prompt:
        'Create a workflow that reads candidate record pairs from a table, supplies their structured fields to TypeSafe Estimate Yes/No Probability, and asks whether they identify the same real-world entity. Store the probability and use configurable match, non-match, and review bands before any merge.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['matching', 'data-quality', 'review'],
    },
    {
      icon: ApiIcon,
      title: 'TypeSafe hierarchical classification',
      prompt:
        'Build a workflow that uses TypeSafe Choose an Option to classify a document into a top-level category, then routes to a second TypeSafe block with only that category’s child options. Store both labels and probability distributions, and review low-confidence decisions at either level.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['classification', 'routing', 'documents'],
    },
  ],
  skills: [
    {
      name: 'route-support-ticket',
      description: 'Route a ticket using explicit team criteria and a review fallback.',
      content:
        '# Route Support Ticket\n\n1. Put the ticket text in state and ask which team should respond.\n2. Use typesafe_choice with descriptive billing, technical, and account options, including an out-of-scope option when needed.\n3. Route on choice with a Condition block, and configure a confidence threshold for review using representative tickets.\n4. Retain probabilities and the resolved model for audit.\n\nSource: https://docs.typesafe.ai/patterns/intent-routing',
    },
    {
      name: 'score-ticket-urgency',
      description: 'Score urgency on an ordered rubric without rounding the expected score.',
      content:
        '# Score Ticket Urgency\n\n1. Put the ticket and relevant service context in state.\n2. Use typesafe_score with 2–10 ordered descriptions from routine to critical. Scores are indexed from zero.\n3. Preserve the fractional score, legend, probabilities, and confidence.\n4. Use a Condition block for an escalation threshold calibrated on your tickets.\n\nSource: https://docs.typesafe.ai/primitives/score',
    },
    {
      name: 'screen-llm-content',
      description:
        'Evaluate independent content-policy questions before releasing an Agent response.',
      content:
        '# Screen LLM Content\n\n1. Put the candidate response and explicit policy in structured state.\n2. Use typesafe_evaluate with separate Noul questions for each policy concern, such as sensitive-data disclosure and disallowed content. Define what true means for each.\n3. Read answers by question ID. Each noul is a probability, not a boolean or an enforcement guarantee.\n4. Apply configurable Condition-block thresholds for release or review and evaluate them on representative content.\n\nSource: https://docs.typesafe.ai/cookbooks/llm_guardrails',
    },
    {
      name: 'verify-citation-support',
      description: 'Estimate whether supplied source passages support individual claims.',
      content:
        '# Verify Citation Support\n\n1. Supply claims and their actual source passages as structured state; Jev does not fetch source URLs.\n2. Use typesafe_evaluate with an independent Noul question for each claim, asking whether its cited passage supports it.\n3. Preserve question IDs and support probabilities. Source support does not independently establish that a claim is true.\n4. Configure downstream review thresholds for uncertain or unsupported claims.\n\nSource: https://docs.typesafe.ai/cookbooks/citation_check',
    },
    {
      name: 'classify-rag-passages',
      description: 'Classify retrieved passages by relevance to a query.',
      content:
        '# Classify RAG Passages\n\n1. Retrieve passages using the knowledge base or a search tool.\n2. For each passage, supply the query and passage as state to typesafe_choice.\n3. Define relevant, partially relevant, and irrelevant with explicit criteria for answering the query.\n4. Preserve labels and distributions, then select passages for the downstream Agent using your configured relevance policy.\n\nSource: https://docs.typesafe.ai/cookbooks/classifying_rag_passages',
    },
    {
      name: 'match-entities',
      description: 'Estimate whether two structured records refer to the same entity.',
      content:
        '# Match Entities\n\n1. Supply both candidate records, including names, addresses, and identifiers, as structured state.\n2. Use typesafe_noul to ask whether they refer to the same real-world entity, with explicit true and false criteria.\n3. Preserve the probability, including zero and one.\n4. Calibrate match, non-match, and review bands with a Condition block. Require review before merging ambiguous records.\n\nSource: https://docs.typesafe.ai/cookbooks/entity_alignment',
    },
    {
      name: 'classify-hierarchically',
      description: 'Walk a category hierarchy with sequential Choice decisions.',
      content:
        '# Classify Hierarchically\n\n1. Supply the document as state and use typesafe_choice for its top-level category.\n2. Route on that result to a second Choice operation containing only the selected category’s children.\n3. Preserve each label, probability map, and confidence, with review paths for uncertainty.\n4. Keep dependent levels in sequential blocks: questions in one Evaluate request are independent and cannot consume each other’s answers.\n\nSource: https://docs.typesafe.ai/cookbooks/hierarchical_classification',
    },
  ],
} as const satisfies BlockMeta
