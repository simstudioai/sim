# Workflow YAML Store

This store dynamically generates a condensed YAML representation of workflows from the JSON workflow state. It extracts input values, connections, and block relationships to create a clean, readable format.

## Features

- **Dynamic Input Extraction**: Automatically reads input values from block configurations and subblock stores
- **Connection Mapping**: Determines preceding and following blocks from workflow edges
- **Type-Aware Processing**: Handles different input types (text, numbers, booleans, objects) appropriately
- **Auto-Refresh**: Automatically updates when workflow state or input values change
- **Clean Format**: Generates well-formatted YAML with proper indentation

## YAML Structure

```yaml
version: "1.0"
blocks:
  block-id-1:
    type: "starter"
    name: "Start"
    inputs:
      startWorkflow: "manual"
    following:
      - "block-id-2"
  
  block-id-2:
    type: "agent"
    name: "AI Agent"
    inputs:
      systemPrompt: "You are a helpful assistant"
      userPrompt: "Process the input data"
      model: "gpt-4"
      temperature: 0.7
    preceding:
      - "block-id-1"
    following:
      - "block-id-3"
```

## Usage

### Basic Usage

```typescript
import { useWorkflowYamlStore } from '@/stores/workflows/yaml/store'

function WorkflowYamlViewer() {
  const yaml = useWorkflowYamlStore(state => state.getYaml())
  
  return (
    <pre>
      <code>{yaml}</code>
    </pre>
  )
}
```

### Manual Refresh

```typescript
import { useWorkflowYamlStore } from '@/stores/workflows/yaml/store'

function WorkflowControls() {
  const refreshYaml = useWorkflowYamlStore(state => state.refreshYaml)
  
  return (
    <button onClick={refreshYaml}>
      Refresh YAML
    </button>
  )
}
```

### Advanced Usage

```typescript
import { useWorkflowYamlStore } from '@/stores/workflows/yaml/store'

function WorkflowExporter() {
  const { yaml, lastGenerated, generateYaml } = useWorkflowYamlStore()
  
  const exportToFile = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'workflow.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }
  
  return (
    <div>
      <p>Last generated: {lastGenerated ? new Date(lastGenerated).toLocaleString() : 'Never'}</p>
      <button onClick={generateYaml}>Regenerate</button>
      <button onClick={exportToFile}>Export YAML</button>
    </div>
  )
}
```

## Input Types Handled

The store intelligently processes different subblock input types:

- **Text Inputs** (`short-input`, `long-input`): Trimmed strings
- **Dropdowns/Combobox** (`dropdown`, `combobox`): Selected values
- **Tables** (`table`): Arrays of objects (only if non-empty)
- **Code Blocks** (`code`): Preserves formatting for strings and objects
- **Switches** (`switch`): Boolean values
- **Sliders** (`slider`): Numeric values
- **Checkbox Lists** (`checkbox-list`): Arrays of selected items

## Auto-Refresh Behavior

The store automatically refreshes in these scenarios:

1. **Workflow Structure Changes**: When blocks are added, removed, or connections change
2. **Input Value Changes**: When any subblock input values are modified
3. **Debounced Updates**: Changes are debounced to prevent excessive regeneration

## Performance

- **Lazy Generation**: YAML is only generated when requested
- **Caching**: Results are cached and only regenerated when data changes
- **Debouncing**: Rapid changes are debounced to improve performance
- **Selective Updates**: Only regenerates when meaningful changes occur

## Error Handling

If YAML generation fails, the store returns an error message in YAML comment format:

```yaml
# Error generating YAML: [error message]
```

## Dependencies

- `js-yaml`: For YAML serialization
- `zustand`: For state management
- `@/blocks`: For block configuration access
- `@/stores/workflows/workflow/store`: For workflow state
- `@/stores/workflows/subblock/store`: For input values 