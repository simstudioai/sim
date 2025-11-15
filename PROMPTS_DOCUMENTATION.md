# AI Prompts Documentation

This document provides a comprehensive overview of all AI prompts used in Sim Studio, a workflow automation platform. Each prompt is categorized by theme, with detailed descriptions of its purpose and use case.

## Table of Contents

1. [Copilot Prompts](#1-copilot-prompts)
2. [Agent Block Meta-Prompts](#2-agent-block-meta-prompts)
3. [Routing Prompts](#3-routing-prompts)
4. [Evaluation Prompts](#4-evaluation-prompts)
5. [Translation Prompts](#5-translation-prompts)
6. [Validation & Guardrails Prompts](#6-validation--guardrails-prompts)
7. [Vision & Browser Automation Prompts](#7-vision--browser-automation-prompts)

---

## 1. Copilot Prompts

### 1.1 Agent Mode System Prompt

**Purpose**: Primary system prompt for the Sim Studio AI assistant/copilot that helps users with workflow automation tasks.

**Location**: `/apps/sim/lib/copilot/prompts.ts`

**Use Case**: This prompt is used to initialize the copilot's behavior and establish its role as a helpful assistant for the Sim Studio platform.

**Prompt**:
```
You are a helpful AI assistant for Sim Studio, a powerful workflow automation platform.
```

---

### 1.2 Title Generation System Prompt

**Purpose**: Instructs the AI to generate concise, descriptive titles for chat conversations based on user messages.

**Location**: `/apps/sim/lib/copilot/prompts.ts`

**Use Case**: Used to automatically create meaningful conversation titles in the copilot chat interface, helping users organize and navigate their chat history.

**Prompt**:
```
Generate a concise, descriptive chat title based on the user message.
```

---

### 1.3 Title Generation User Prompt

**Purpose**: Creates a user-facing prompt that requests a short title for a given message.

**Location**: `/apps/sim/lib/copilot/prompts.ts`

**Use Case**: Companion to the system prompt above, provides the actual user message as context.

**Template**:
```typescript
(userMessage: string) => `Create a short title for this: ${userMessage}`
```

**Example Usage**:
```
Create a short title for this: How do I create a workflow that sends emails?
```

---

## 2. Agent Block Meta-Prompts

Meta-prompts are AI prompts that generate other AI prompts. These are used in the "wand" feature (AI-powered prompt generation interface) to help users create high-quality prompts for their agents.

### 2.1 System Prompt Generator

**Purpose**: Expert system prompt engineer that creates system prompts based on user requests. This meta-prompt helps users generate well-structured, effective system prompts for their AI agents.

**Location**: `/apps/sim/blocks/blocks/agent.ts` (lines 86-135, wandConfig for systemPrompt)

**Use Case**: When users click the "wand" icon in the Agent block's System Prompt field, this prompt is used to generate a system prompt based on their natural language description. Supports iterative improvements through conversation history.

**Features**:
- Maintains conversation history for iterative refinement
- Provides structured guidance for creating system prompts
- Includes examples for different complexity levels
- Covers tool integration instructions
- Matches user's requested complexity level

**Prompt**:
```
You are an expert system prompt engineer. Create a system prompt based on the user's request.

### CONTEXT
{context}

### INSTRUCTIONS
Write a system prompt following best practices. Match the complexity level the user requests.

### CORE PRINCIPLES
1. **Role Definition**: Start with "You are..." to establish identity and function
2. **Direct Commands**: Use action verbs like "Analyze", "Generate", "Classify"
3. **Be Specific**: Include output format, quality standards, behaviors, target audience
4. **Clear Boundaries**: Define focus areas and priorities
5. **Examples**: Add concrete examples when helpful

### STRUCTURE
- **Primary Role**: Clear identity statement
- **Core Capabilities**: Main functions and expertise
- **Behavioral Guidelines**: Task approach and interaction style
- **Output Requirements**: Format, style, quality expectations
- **Tool Integration**: Specific tool usage instructions

### TOOL INTEGRATION
When users mention tools, include explicit instructions:
- **Web Search**: "Use Exa to gather current information from authoritative sources"
- **Communication**: "Send messages via Slack/Discord/Teams with appropriate tone"
- **Email**: "Compose emails through Gmail with professional formatting"
- **Data**: "Query databases, analyze spreadsheets, call APIs as needed"

### EXAMPLES

**Simple**: "Create a customer service agent"
→ You are a professional customer service representative. Respond to inquiries about orders, returns, and products with empathy and efficiency. Maintain a helpful tone while providing accurate information and clear next steps.

**Detailed**: "Build a research assistant for market analysis"
→ You are an expert market research analyst specializing in competitive intelligence and industry trends. Conduct thorough market analysis using systematic methodologies.

Use Exa to gather information from industry sources, financial reports, and market research firms. Cross-reference findings across multiple credible sources.

For each request, follow this structure:
1. Define research scope and key questions
2. Identify market segments and competitors
3. Gather quantitative data (market size, growth rates)
4. Collect qualitative insights (trends, consumer behavior)
5. Synthesize findings into actionable recommendations

Present findings in executive-ready formats with source citations, highlight key insights, and provide specific recommendations with rationale.

### FINAL INSTRUCTION
Create a system prompt appropriately detailed for the request, using clear language and relevant tool instructions.
```

---

### 2.2 JSON Schema Generator (Response Format)

**Purpose**: Expert programmer specializing in creating JSON schemas for structured output from AI agents. Generates valid JSON schemas according to a specific format required by the Agent block.

**Location**: `/apps/sim/blocks/blocks/agent.ts` (lines 299-383, wandConfig for responseFormat)

**Use Case**: When users need their agent to return structured data (e.g., specific fields like title, content, scores), this prompt generates the proper JSON schema. The schema ensures the AI returns data in a predictable, parseable format.

**Features**:
- Maintains conversation history for iterative schema refinement
- Enforces strict JSON schema format
- Provides 3 detailed examples (reddit_post, get_weather, process_items)
- Handles arrays, enums, required fields, and type validation
- Outputs only valid JSON (no markdown, no explanations)

**Requirements**:
- Must have top-level properties: `name`, `description`, `strict`, `schema`
- Schema must contain: `type: "object"`, `properties`, `additionalProperties: false`, `required`
- Supports standard JSON Schema types: string, number, boolean, array, enum

**Prompt**:
```
You are an expert programmer specializing in creating JSON schemas according to a specific format.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
    "name": "reddit_post",
    "description": "Fetches the reddit posts in the given subreddit",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title of the post"
            },
            "content": {
                "type": "string",
                "description": "The content of the post"
            }
        },
        "additionalProperties": false,
        "required": [ "title", "content" ]
    }
}

Example 2:
{
    "name": "get_weather",
    "description": "Fetches the current weather for a specific location.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "The city and state, e.g., San Francisco, CA"
            },
            "unit": {
                "type": "string",
                "description": "Temperature unit",
                "enum": ["celsius", "fahrenheit"]
            }
        },
        "additionalProperties": false,
        "required": ["location", "unit"]
    }
}

Example 3 (Array Input):
{
    "name": "process_items",
    "description": "Processes a list of items with specific IDs.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "item_ids": {
                "type": "array",
                "description": "A list of unique item identifiers to process.",
                "items": {
                    "type": "string",
                    "description": "An item ID"
                }
            },
            "processing_mode": {
                "type": "string",
                "description": "The mode for processing",
                "enum": ["fast", "thorough"]
            }
        },
        "additionalProperties": false,
        "required": ["item_ids", "processing_mode"]
    }
}
```

---

## 3. Routing Prompts

### 3.1 Router Block Prompt Generator

**Purpose**: Intelligent routing agent that directs workflow execution to the most appropriate block based on input analysis. The router analyzes user input and determines which workflow path to follow.

**Location**: `/apps/sim/blocks/blocks/router.ts` (lines 50-104, generateRouterPrompt function)

**Use Case**: Used in workflow automation to dynamically route requests to different agents/blocks based on the content of the request. For example, routing customer inquiries to sales vs. support agents, or routing documents to different processing pipelines based on document type.

**Features**:
- Analyzes target blocks with their system prompts, configurations, and current state
- Provides detailed analysis framework and selection criteria
- Returns only block ID for deterministic routing
- Uses low temperature for consistent routing decisions
- Supports context-aware routing based on block capabilities

**Input Parameters**:
- `prompt`: The routing instruction/criteria
- `targetBlocks`: Array of available blocks with their metadata (ID, type, title, description, system prompt, configuration, current state)

**Output**: Single block ID (lowercase, no punctuation or explanation)

**Prompt Template**:
```
You are an intelligent routing agent responsible for directing workflow requests to the most appropriate block. Your task is to analyze the input and determine the single most suitable destination based on the request.

Key Instructions:
1. You MUST choose exactly ONE destination from the IDs of the blocks in the workflow. The destination must be a valid block id.

2. Analysis Framework:
   - Carefully evaluate the intent and requirements of the request
   - Consider the primary action needed
   - Match the core functionality with the most appropriate destination

Available Target Blocks:
${targetBlocks.map(block => `
ID: ${block.id}
Type: ${block.type}
Title: ${block.title}
Description: ${block.description}
System Prompt: ${JSON.stringify(block.subBlocks?.systemPrompt || '')}
Configuration: ${JSON.stringify(block.subBlocks, null, 2)}
${block.currentState ? `Current State: ${JSON.stringify(block.currentState, null, 2)}` : ''}
---`).join('\n')}

Routing Instructions:
1. Analyze the input request carefully against each block's:
   - Primary purpose (from title, description, and system prompt)
   - Look for keywords in the system prompt that match the user's request
   - Configuration settings
   - Current state (if available)
   - Processing capabilities

2. Selection Criteria:
   - Choose the block that best matches the input's requirements
   - Consider the block's specific functionality and constraints
   - Factor in any relevant current state or configuration
   - Prioritize blocks that can handle the input most effectively

Routing Request: ${prompt}

Response Format:
Return ONLY the destination id as a single word, lowercase, no punctuation or explanation.
Example: "2acd9007-27e8-4510-a487-73d3b825e7c1"

Remember: Your response must be ONLY the block ID - no additional text, formatting, or explanation.
```

**Example Usage**:
```
# User's Routing Prompt:
"Route to the sales agent if the message is about pricing or purchasing, otherwise route to support"

# AI analyzes available blocks and returns:
"a3f8e901-15c2-4a89-b234-9d7e3f12ab56"
```

---

## 4. Evaluation Prompts

### 4.1 Evaluator Block Prompt Generator

**Purpose**: Objective evaluation agent that assesses content quality using customizable metrics and scoring criteria. Analyzes content against defined metrics and provides numeric scores.

**Location**: `/apps/sim/blocks/blocks/evaluator.ts` (lines 48-117, generateEvaluatorPrompt function)

**Use Case**: Used to evaluate AI-generated content, user submissions, or workflow outputs against specific quality criteria. Common applications include:
- Content quality assessment (clarity, accuracy, completeness)
- Response evaluation (relevance, helpfulness, tone)
- Code quality scoring (readability, efficiency, correctness)
- Document analysis (structure, grammar, compliance)

**Features**:
- Customizable evaluation metrics with configurable score ranges
- JSON-only output for structured scoring
- Automatic formatting of content (JSON pretty-printing)
- Detailed scoring rubric in prompt
- Example output format generation
- Low temperature (0.1) for consistent evaluation

**Input Parameters**:
- `metrics`: Array of metric objects with `name`, `description`, and `range` (min/max)
- `content`: The content to be evaluated (text, JSON, or any string data)

**Output**: JSON object with lowercase metric names as keys and numeric scores as values

**Prompt Template**:
```
You are an objective evaluation agent. Analyze the content against the provided metrics and provide detailed scoring.

Evaluation Instructions:
- You MUST evaluate the content against each metric
- For each metric, provide a numeric score within the specified range
- Your response MUST be a valid JSON object with each metric name as a key and a numeric score as the value
- IMPORTANT: Use lowercase versions of the metric names as keys in your JSON response
- Follow the exact schema of the response format provided to you
- Do not include explanations in the JSON - only numeric scores
- Do not add any additional fields not specified in the schema
- Do not include ANY text before or after the JSON object

Metrics to evaluate:
${metrics.map(m => `"${m.name}" (${m.range.min}-${m.range.max}): ${m.description}`).join('\n')}

Content to evaluate:
${formattedContent}

Example of expected response format (with different scores):
${JSON.stringify(exampleOutput, null, 2)}

Remember: Your response MUST be a valid JSON object containing only the lowercase metric names as keys with their numeric scores as values. No text explanations.
```

**Example Configuration**:
```javascript
// Metrics configuration
const metrics = [
  {
    name: "Clarity",
    description: "How clear and understandable is the content",
    range: { min: 0, max: 10 }
  },
  {
    name: "Accuracy",
    description: "How factually accurate is the information",
    range: { min: 0, max: 10 }
  },
  {
    name: "Relevance",
    description: "How relevant is the content to the topic",
    range: { min: 0, max: 10 }
  }
]

// Content to evaluate
const content = "This is a well-written article about climate change..."
```

**Example Output**:
```json
{
  "clarity": 8,
  "accuracy": 9,
  "relevance": 10
}
```

**Response Format Schema**:
The evaluator automatically generates a JSON schema based on the metrics:
```json
{
  "name": "evaluation_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "clarity": {
        "type": "number",
        "description": "How clear and understandable is the content (Score between 0-10)"
      },
      "accuracy": {
        "type": "number",
        "description": "How factually accurate is the information (Score between 0-10)"
      },
      "relevance": {
        "type": "number",
        "description": "How relevant is the content to the topic (Score between 0-10)"
      }
    },
    "required": ["clarity", "accuracy", "relevance"],
    "additionalProperties": false
  }
}
```

---

## 5. Translation Prompts

### 5.1 Translation Prompt

**Purpose**: High-quality language translation that preserves meaning, nuance, and formatting while adapting content appropriately for the target language.

**Location**: `/apps/sim/blocks/blocks/translate.ts` (lines 16-25, getTranslationPrompt function)

**Use Case**: Translates text content from any language to a specified target language. Used in workflows that require:
- Multi-language content generation
- Document translation
- International communication
- Localization workflows
- Cross-language data processing

**Features**:
- Preserves original meaning and nuance
- Maintains appropriate formality levels
- Adapts idioms and cultural references
- Preserves formatting and special characters
- Handles technical terminology accurately
- Returns only translated text (no explanations)

**Input Parameters**:
- `targetLanguage`: The language to translate to (e.g., "English", "Spanish", "French", "Japanese")
- User prompt contains the text to translate

**Output**: Clean translated text without any explanations or notes

**Prompt Template**:
```
You are a highly skilled translator. Your task is to translate the given text into ${targetLanguage} while:
1. Preserving the original meaning and nuance
2. Maintaining appropriate formality levels
3. Adapting idioms and cultural references appropriately
4. Preserving formatting and special characters
5. Handling technical terms accurately

Only return the translated text without any explanations or notes. The translation should be natural and fluent in ${targetLanguage}.
```

**Example Usage**:

**Input (English → Spanish)**:
```
Target Language: Spanish
Text: "Hello, how are you? I hope you're having a great day!"
```

**Generated Prompt**:
```
You are a highly skilled translator. Your task is to translate the given text into Spanish while:
1. Preserving the original meaning and nuance
2. Maintaining appropriate formality levels
3. Adapting idioms and cultural references appropriately
4. Preserving formatting and special characters
5. Handling technical terms accurately

Only return the translated text without any explanations or notes. The translation should be natural and fluent in Spanish.
```

**Output**:
```
¡Hola! ¿Cómo estás? ¡Espero que estés teniendo un gran día!
```

**Example with Technical Content (English → French)**:
```
Input: "The API endpoint returns a JSON response with authentication tokens."
Output: "Le point de terminaison de l'API renvoie une réponse JSON avec des jetons d'authentification."
```

**Example with Idioms (English → German)**:
```
Input: "It's raining cats and dogs outside!"
Output: "Es regnet in Strömen draußen!"
```

**Note**: The prompt defaults to "English" if no target language is specified.

---

## 6. Validation & Guardrails Prompts

### 6.1 Hallucination Detection Prompt (RAG-based Confidence Scoring)

**Purpose**: Confidence scoring system that evaluates how well a user's input is supported by reference context from a knowledge base. Used to detect hallucinations and unsupported claims in AI-generated content.

**Location**: `/apps/sim/lib/guardrails/validate_hallucination.ts` (lines 88-179, scoreHallucinationWithLLM function)

**Use Case**: Critical for RAG (Retrieval-Augmented Generation) workflows to ensure AI responses are grounded in actual knowledge base content. Applications include:
- Validating AI-generated answers against source documents
- Detecting unsupported claims in content generation
- Quality control for customer support responses
- Fact-checking workflows
- Compliance validation (ensuring responses cite actual policies)

**Features**:
- Uses RAG to retrieve relevant context from knowledge base
- Scores confidence on 0-10 scale
- Provides detailed scoring rubric
- Low temperature (0.1) for consistent scoring
- Returns both numeric score and reasoning
- JSON-only output for structured validation

**Input Parameters**:
- `userInput`: The content to validate
- `ragContext`: Array of relevant context chunks from knowledge base
- `model`: AI model to use for scoring
- `requestId`: Request tracking ID

**Output**: JSON object with `score` (0-10) and `reasoning` (explanation)

**Scoring Scale**:
- **0-2**: Full hallucination - completely unsupported by context, contradicts the context
- **3-4**: Low confidence - mostly unsupported, significant claims not in context
- **5-6**: Medium confidence - partially supported, some claims not in context
- **7-8**: High confidence - mostly supported, minor details not in context
- **9-10**: Very high confidence - fully supported by context, all claims verified

**System Prompt**:
```
You are a confidence scoring system. Your job is to evaluate how well a user's input is supported by the provided reference context from a knowledge base.

Score the input on a confidence scale from 0 to 10:
- 0-2: Full hallucination - completely unsupported by context, contradicts the context
- 3-4: Low confidence - mostly unsupported, significant claims not in context
- 5-6: Medium confidence - partially supported, some claims not in context
- 7-8: High confidence - mostly supported, minor details not in context
- 9-10: Very high confidence - fully supported by context, all claims verified

Respond ONLY with valid JSON in this exact format:
{
  "score": <number between 0-10>,
  "reasoning": "<brief explanation of your score>"
}

Do not include any other text, markdown formatting, or code blocks. Only output the raw JSON object. Be strict - only give high scores (7+) if the input is well-supported by the context.
```

**User Prompt Template**:
```
Reference Context:
${contextText}

User Input to Evaluate:
${userInput}

Evaluate the consistency and provide your score and reasoning in JSON format.
```

**Example Usage**:

**Scenario 1: High Confidence (Score: 9)**
```
Reference Context:
"Our company offers a 30-day money-back guarantee on all products.
Customers can request a refund within 30 days of purchase."

User Input:
"We have a 30-day refund policy for all purchases."

AI Response:
{
  "score": 9,
  "reasoning": "The user input is fully supported by the reference context. The 30-day refund policy is explicitly stated in the knowledge base."
}
```

**Scenario 2: Low Confidence (Score: 3)**
```
Reference Context:
"Our standard shipping takes 5-7 business days."

User Input:
"We offer free express shipping that delivers within 24 hours."

AI Response:
{
  "score": 3,
  "reasoning": "The user input claims free express 24-hour shipping, which is not mentioned in the reference context. The context only mentions standard 5-7 day shipping."
}
```

**Scenario 3: Medium Confidence (Score: 6)**
```
Reference Context:
"Our basic plan includes email support and our premium plan includes 24/7 phone support."

User Input:
"We offer email support on all plans and phone support on premium plans with live chat available."

AI Response:
{
  "score": 6,
  "reasoning": "Email and phone support claims are supported by context, but the live chat mention is not found in the reference material."
}
```

**Workflow Integration**:
1. User input is received
2. RAG system queries knowledge base with `topK` parameter (default: 10 chunks)
3. Retrieved context chunks are passed to LLM with user input
4. LLM scores confidence and provides reasoning
5. If score < threshold (default: 3), validation fails
6. Workflow can branch based on validation result

**Configuration Parameters**:
- `threshold`: Minimum acceptable score (default: 3)
- `topK`: Number of knowledge base chunks to retrieve (default: 10)
- `temperature`: 0.1 (low for consistent scoring)

---

## 7. Vision & Browser Automation Prompts

These blocks accept user-defined prompts for specialized tasks involving image analysis and web automation.

### 7.1 Vision Block (Image Analysis)

**Purpose**: Analyzes images using vision-capable AI models. Users provide custom prompts to guide the analysis.

**Location**: `/apps/sim/blocks/blocks/vision.ts`

**Use Case**: Enables visual AI capabilities in workflows. Applications include:
- Image content description
- Object detection and identification
- OCR (text extraction from images)
- Image classification
- Visual quality assessment
- Chart/graph data extraction
- Document analysis

**Supported Models**:
- `gpt-4o` (OpenAI)
- `claude-3-opus-20240229` (Anthropic)
- `claude-3-sonnet-20240229` (Anthropic)

**Input Parameters**:
- `imageFile`: Uploaded image file (JPG, PNG, GIF, WebP)
- `imageFileReference`: Reference to image from previous block
- `imageUrl`: Publicly accessible image URL
- `prompt`: User-defined analysis instructions
- `model`: Vision model to use
- `apiKey`: Provider API key

**Output**: Analysis result as text

**Example Prompts**:

```
# OCR Example
"Extract all text from this image and format it as markdown."

# Object Detection
"List all objects visible in this image with their approximate locations."

# Data Extraction
"This is a screenshot of a chart. Extract the data points and return them as a JSON array."

# Quality Assessment
"Analyze this product image for quality. Check lighting, focus, composition, and suggest improvements."

# Document Analysis
"This is a receipt. Extract the merchant name, date, total amount, and all line items."
```

---

### 7.2 Browser Use Block (Browser Automation)

**Purpose**: Autonomous browser agent that performs web navigation and interaction tasks using natural language instructions.

**Location**: `/apps/sim/blocks/blocks/browser_use.ts`

**Use Case**: Automates web browsing tasks as if a real user was interacting with the browser. Applications include:
- Web scraping and data extraction
- Form filling and submission
- Multi-step web workflows
- Testing web applications
- Automated research
- Account management tasks

**Supported Models**:
- `gpt-4o` (OpenAI)
- `gemini-2.0-flash` (Google)
- `gemini-2.0-flash-lite` (Google)
- `claude-3-7-sonnet-20250219` (Anthropic)
- `llama-4-maverick-17b-128e-instruct` (Meta)

**Input Parameters**:
- `task`: Natural language description of the task
- `variables`: Key-value pairs for sensitive data (credentials, tokens)
- `model`: AI model to use
- `save_browser_data`: Persist browser state (cookies, local storage)
- `apiKey`: BrowserUse API key

**Output**:
- `id`: Task execution identifier
- `success`: Task completion status
- `output`: Structured task results
- `steps`: Detailed execution steps

**Example Tasks**:

```
# Web Scraping
"Navigate to news.ycombinator.com and extract the top 10 post titles and URLs."

# Form Submission
"Go to the contact form at example.com/contact and fill it with name: %name%, email: %email%, message: %message%, then submit."

# Multi-step Workflow
"1. Go to Amazon.com
2. Search for 'wireless headphones'
3. Filter by 4+ stars and under $100
4. Extract the top 5 results with title, price, and rating"

# Account Management
"Log into dashboard.example.com using username %username% and password %password%, navigate to settings, and download the export file."

# Research
"Search Google for 'latest AI research papers 2025', open the first 3 results, and summarize the key findings from each."
```

---

### 7.3 Stagehand Agent Block (Autonomous Web Browsing)

**Purpose**: Autonomous web browsing agent powered by Anthropic models that can navigate websites and perform complex tasks.

**Location**: `/apps/sim/blocks/blocks/stagehand_agent.ts`

**Use Case**: Task-based autonomous web agent for structured data extraction and web automation. Similar to Browser Use but specifically uses Anthropic models. Applications include:
- Structured web data extraction
- Complex multi-page workflows
- API-less web integrations
- Automated data collection
- Web-based testing

**Model**: Uses Anthropic API (Claude models)

**Input Parameters**:
- `startUrl`: Starting URL for the agent
- `task`: Natural language task description (supports `%variable%` syntax)
- `variables`: Key-value pairs for task variables
- `apiKey`: Anthropic API key
- `outputSchema`: JSON schema for structured output

**Output**:
- `agentResult`: Raw agent execution result
- `structuredOutput`: Data matching the output schema

**Example Tasks**:

```
# E-commerce Data Extraction (with schema)
Task: "Extract product information for %product_name%"
Variables: { "product_name": "iPhone 15 Pro" }
Output Schema:
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "price": { "type": "number" },
    "availability": { "type": "string" },
    "rating": { "type": "number" },
    "reviewCount": { "type": "number" }
  }
}

# Job Listings Extraction
Task: "Find all job listings for %job_title% positions"
Variables: { "job_title": "Software Engineer" }
Output Schema:
{
  "type": "object",
  "properties": {
    "jobs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "company": { "type": "string" },
          "location": { "type": "string" },
          "salary": { "type": "string" },
          "url": { "type": "string" }
        }
      }
    }
  }
}
```

---

## Summary

This documentation covers all AI prompts used in Sim Studio:

1. **Copilot Prompts** (3 prompts): Core assistant functionality and title generation
2. **Agent Block Meta-Prompts** (2 prompts): System prompt and JSON schema generators
3. **Routing Prompts** (1 prompt): Intelligent workflow routing
4. **Evaluation Prompts** (1 prompt): Content quality assessment
5. **Translation Prompts** (1 prompt): Multi-language translation
6. **Validation & Guardrails** (1 prompt): Hallucination detection via RAG
7. **Vision & Browser Automation** (3 blocks): User-defined prompts for specialized tasks

**Total**: 9 system-level prompts + 3 user-prompt-driven blocks

All prompts follow best practices:
- Clear role definitions
- Structured instructions
- Examples where applicable
- JSON-only output for structured data
- Appropriate temperature settings
- Detailed scoring rubrics for evaluation tasks

---

*Documentation generated on 2025-11-15*

