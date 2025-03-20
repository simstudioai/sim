import { SimStudio, AgentBlock, WorkflowCodeGenerator } from '../src'
import * as fs from 'fs'
import * as path from 'path'

const __dirname = path.resolve()

/**
 * Example demonstrating how to generate TypeScript code from a workflow
 */
async function generateWorkflowCode() {
  const simStudio = new SimStudio({
    apiKey: 'your-api-key',
  })

  const workflowBuilder = simStudio.createWorkflow(
    'Content Creation Workflow',
    'Generate and optimize content for blog posts'
  )

  // Add blocks
  const ideaGeneratorBlock = new AgentBlock({
    model: 'claude-3-sonnet',
    prompt: 'Generate 5 blog post ideas about {{input.topic}}',
    systemPrompt: 'You are a creative content strategist.',
    temperature: 0.8,
    apiKey: 'your-agent-api-key'
  }).setName('Generate Ideas')

  const outlineBlock = new AgentBlock({
    model: 'claude-3-sonnet',
    prompt: 'Create a detailed outline for this blog post idea: {{input.selectedIdea}}',
    systemPrompt: 'You are a skilled content outliner.',
    temperature: 0.7,
    apiKey: 'your-agent-api-key'
  }).setName('Create Outline')

  const draftBlock = new AgentBlock({
    model: 'claude-3-opus',
    prompt: 'Write a blog post based on this outline: {{input.outline}}',
    systemPrompt: 'You are a professional blog writer with expertise in creating engaging content.',
    temperature: 0.6,
    maxTokens: 2500,
    apiKey: 'your-agent-api-key'
  }).setName('Write Draft')

  const optimizeBlock = new AgentBlock({
    model: 'claude-3-haiku',
    prompt: 'Optimize this blog post for SEO: {{input.draft}}',
    systemPrompt: 'You are an SEO expert. Add relevant keywords, improve readability, and optimize for search engines.',
    temperature: 0.4,
    apiKey: 'your-agent-api-key'
  }).setName('Optimize for SEO')

  // Add blocks to workflow
  workflowBuilder
    .addBlock(ideaGeneratorBlock)
    .addBlock(outlineBlock)
    .addBlock(draftBlock)
    .addBlock(optimizeBlock)

  // Connect blocks
  const starterBlock = workflowBuilder.getStarterBlock()
  workflowBuilder
    .connect(starterBlock.id, ideaGeneratorBlock.id)
    .connect(ideaGeneratorBlock.id, outlineBlock.id)
    .connect(outlineBlock.id, draftBlock.id)
    .connect(draftBlock.id, optimizeBlock.id)

  // Build the workflow
  const workflow = workflowBuilder.build()

  // Generate TypeScript code
  const codeGenerator = new WorkflowCodeGenerator(workflow, {
    includeComments: true,
    prettyPrint: true,
    addGenerationInfo: true,
    exportAsModule: true,
    mainFunctionName: 'createContentWorkflow',
    moduleFormat: 'commonjs',
  })

  const generatedCode = codeGenerator.generate()

  // Save the generated code to a file
  const outputDir = path.join(__dirname, 'examples', 'output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const outputFile = path.join(outputDir, 'content-workflow.ts')
  fs.writeFileSync(outputFile, generatedCode)

  return {
    workflow,
    generatedCode,
    outputFile,
  }
}

// Run the example
generateWorkflowCode().catch(console.error) 