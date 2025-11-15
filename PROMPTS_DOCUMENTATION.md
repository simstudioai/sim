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
