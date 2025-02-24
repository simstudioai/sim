# Contributing to Sim Studio

Thank you for your interest in contributing to Sim Studio! Our goal is to provide developers with a powerful, user-friendly platform for building, testing, and optimizing agentic workflows. We welcome contributions in all forms—from bug fixes and design improvements to brand-new features.

> **Project Overview:**  
> Sim Studio is built with Next.js (app router), ReactFlow, Zustand, Shadcn, and Tailwind CSS. Please ensure your contributions follow our best practices for clarity, maintainability, and consistency.

---

## Table of Contents

- [How to Contribute](#how-to-contribute)
- [Reporting Issues](#reporting-issues)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Local Development Setup](#local-development-setup)
- [License](#license)
- [Adding New Blocks and Tools](#adding-new-blocks-and-tools)

---

## How to Contribute

We strive to keep our workflow as simple as possible. To contribute:

1. **Fork the Repository**  
   Click the **Fork** button on GitHub to create your own copy of the project.

2. **Clone Your Fork**
   ```bash
   git clone https://github.com/<your-username>/sim.git
   ```
3. **Create a Feature Branch**  
   Create a new branch with a descriptive name:

   ```bash
   git checkout -b feat/your-feature-name
   ```

   Use a clear naming convention to indicate the type of work (e.g., `feat/`, `fix/`, `docs/`).

4. **Make Your Changes**  
   Ensure your changes are small, focused, and adhere to our coding guidelines.

5. **Commit Your Changes**  
   Write clear, descriptive commit messages that follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) specification. This allows us to maintain a coherent project history and generate changelogs automatically. For example:
   - `feat(api): add new endpoint for user authentication`
   - `fix(ui): resolve button alignment issue`
   - `docs: update contribution guidelines`
6. **Push Your Branch**

   ```bash
   git push origin feat/your-feature-name
   ```

7. **Create a Pull Request**  
   Open a pull request against the `main` branch on GitHub. Please provide a clear description of the changes and reference any relevant issues (e.g., `fixes #123`).

---

## Reporting Issues

If you discover a bug or have a feature request, please open an issue in our GitHub repository. When opening an issue, ensure you:

- Provide a clear, descriptive title.
- Include as many details as possible (steps to reproduce, screenshots, etc.).
- **Tag Your Issue Appropriately:**  
  Use the following labels to help us categorize your issue:
  - **active:** Actively working on it right now.
  - **bug:** Something isn't working.
  - **design:** Improvements & changes to design & UX.
  - **discussion:** Initiate a discussion or propose an idea.
  - **documentation:** Improvements or updates to documentation.
  - **feature:** New feature or request.

> **Note:** If you're uncertain which label to use, mention it in your issue description and we'll help categorize it.

---

## Pull Request Process

Before creating a pull request:

- **Ensure Your Branch Is Up-to-Date:**  
  Rebase your branch onto the latest `main` branch to prevent merge conflicts.
- **Follow the Guidelines:**  
  Make sure your changes are well-tested, follow our coding standards, and include relevant documentation if necessary.

- **Reference Issues:**  
  If your PR addresses an existing issue, include `refs #<issue-number>` or `fixes #<issue-number>` in your PR description.

Our maintainers will review your pull request and provide feedback. We aim to make the review process as smooth and timely as possible.

---

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) standard. Your commit messages should have the following format:

```
<type>[optional scope]: <description>
```

- **Types** may include:
  - `feat` – a new feature
  - `fix` – a bug fix
  - `docs` – documentation changes
  - `style` – code style changes (formatting, missing semicolons, etc.)
  - `refactor` – code changes that neither fix a bug nor add a feature
  - `test` – adding or correcting tests
  - `chore` – changes to tooling, build process, etc.
  - `high priority` – a high priority feature or fix
  - `high risk` – a high risk feature or fix
  - `improvement` – an improvement to the codebase

_Examples:_

- `feat(auth): add social login integration`
- `fix(ui): correct misaligned button on homepage`
- `docs: update installation instructions`

Using clear and consistent commit messages makes it easier for everyone to understand the project history and aids in automating changelog generation.

---

## Local Development Setup

To set up your local development environment:

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/<your-username>/sim-studio.git
   ```
2. **Navigate to the Project Directory:**
   ```bash
   cd sim-studio
   ```
3. **Install Dependencies:**
   - Using Yarn:
     ```bash
     yarn install
     ```
   - Or using NPM:
     ```bash
     npm install
     ```
4. **Run the Development Server:**
   - With Yarn:
     ```bash
     yarn dev
     ```
   - With NPM:
     ```bash
     npm run dev
     ```
5. **Make Your Changes and Test Locally.**

---

## License

This project is licensed under the MIT License. By contributing, you agree that your contributions will be licensed under the MIT License as well.

---

## Adding New Blocks and Tools

Sim Studio is built in a modular fashion where blocks and tools extend the platform's functionality. To maintain consistency and quality, please follow the guidelines below when adding a new block or tool.

### Where to Add Your Code

- **Blocks:** Create your new block file under the `/blocks/blocks` directory.
- **Tools:** Create your new tool file under the `/tools` directory.

In addition, you will need to update the registries:

- **Block Registry:** Update the blocks index (usually `/blocks/index.ts`) to include your new block.
- **Tool Registry:** Update the tools registry (`/tools/index.ts`) to add your new tool.

### How to Create a New Block

1. **Create a New File:**  
   Create a file for your block (e.g., `newBlock.ts`) in the `/blocks/blocks` directory.

2. **Create a New Icon:**
   Create a new icon for your block in the `/components/icons.tsx` file.

3. **Define the Block Configuration:**  
   Your block should export a constant of type `BlockConfig`. For example:

   ```typescript:blocks/blocks/newBlock.ts
   import { SomeIcon } from '@/components/icons'
   import { BlockConfig } from '../types'

   // Define response type if needed
   interface NewBlockResponse {
     output: {
       // Define expected output here
       result: string
     }
   }

   export const NewBlock: BlockConfig<NewBlockResponse> = {
     type: 'new',
     name: 'New Block',
     description: 'Description of the new block',
     category: 'blocks',
     bgColor: '#123456',
     icon: SomeIcon,
     inputs: {
       // Define inputs here
       exampleInput: { type: 'string', required: true },
     },
     outputs: {
       response: {
         type: {
           result: 'string',
         },
       },
     },
   }
   ```

4. **Register Your Block:**  
   Import and add your block to the blocks registry (`blocks/index.ts`) in the appropriate index file so it appears in the workflow builder.

5. **Test Your Block:**  
   Ensure that the block displays correctly in the UI and that its functionality works as expected.

### How to Create a New Tool

1. **Create a New File:**  
   Create a file for your tool (e.g., `newTool.ts`) in the `/tools` directory.

2. **Define the Tool Configuration:**  
   Your tool should export a constant of type `ToolConfig`. For example:

   ```typescript:tools/newTool.ts
   import { ToolConfig, ToolResponse } from './types'

   interface NewToolParams {
     apiKey: string
     query: string
   }

   interface NewToolResponse extends ToolResponse {
     output: {
       result: string
     }
   }

   export const newTool: ToolConfig<NewToolParams, NewToolResponse> = {
     id: 'new_tool',
     name: 'New Tool',
     description: 'Description for the new tool',
     params: {
       apiKey: { type: 'string', required: true },
       query: { type: 'string', required: true },
     },
     request: {
       url: 'https://api.example.com/query',
       method: 'POST',
       headers: (params) => ({
         'Content-Type': 'application/json',
         Authorization: `Bearer ${params.apiKey}`,
       }),
       body: (params) => JSON.stringify({ query: params.query }),
     },
     transformResponse: async (response: Response) => {
       const data = await response.json()
       return {
         success: true,
         output: { result: data.result },
       }
     },
     transformError: (error) => {
       return error.message || 'An error occurred while processing the tool request'
     },
   }
   ```

3. **Register Your Tool:**  
   Update the tools registry in `/tools/index.ts` to include your new tool. For example, add it to the exported `tools` object:

   ```typescript:tools/index.ts
   import { newTool } from './newTool'
   // ... other imports

   export const tools: Record<string, ToolConfig> = {
     // ... existing tools
     new_tool: newTool,
   }

   export function getTool(toolId: string): ToolConfig | undefined {
     return tools[toolId]
   }
   ```

4. **Test Your Tool:**  
   Ensure that your tool functions correctly by making test requests and verifying the responses.

### Guidelines & Best Practices

- **Code Style:** Follow the project's ESLint and Prettier configurations. Use meaningful variable names and small, focused functions.
- **Documentation:** Clearly document the purpose, inputs, outputs, and any special behavior for your block/tool.
- **Error Handling:** Implement robust error handling and provide user-friendly error messages.
- **Testing:** Add unit or integration tests to verify your changes when possible.
- **Commit Changes:** Update all related components and registries, and describe your changes in your pull request.

Happy coding!

---

Thank you for taking the time to contribute to Sim Studio. We truly appreciate your efforts and look forward to collaborating with you!
