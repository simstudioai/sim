# Block Documentation Generator

This directory contains scripts to automatically generate documentation for all blocks in the Sim platform.

## Available Scripts

- `generate-docs.ts`: Generates documentation for all blocks. Run via `bun run generate-docs` from `apps/sim`, or directly with `bun run scripts/generate-docs.ts` from the repo root.

## How It Works

The documentation generator:

1. Scans the `apps/sim/blocks/blocks/` directory for all block definition files
2. Extracts metadata from each block including:
   - Name, description, and category
   - Input and output specifications
   - Configuration parameters
3. Generates standardized Markdown documentation for each block
4. Updates the navigation metadata in `meta.json`

## Running the Generator

```bash
# From the repo root
bun run scripts/generate-docs.ts
```

Dependencies are managed by Bun workspaces — `bun install` at the repo root installs everything needed.

## CI Integration

The documentation generator runs automatically as part of the CI/CD pipeline whenever changes are pushed to the main branch. The updated documentation is committed back to the repository.

## Adding Support for New Block Properties

If you add new properties to block definitions that should be included in the documentation, update the `generateMarkdownForBlock` function in `scripts/generate-docs.ts`.

## Preserving Manual Content

The documentation generator now supports preserving manually added content when regenerating docs. This allows you to enhance the auto-generated documentation with custom examples, additional context, or any other content without losing your changes when the docs are regenerated.

### How It Works

1. The generator creates clean documentation without any placeholders or markers
2. If you add manual content to a file using special comment markers, that content will be preserved during regeneration
3. The manual content is intelligently inserted at the appropriate section when docs are regenerated

### Using Manual Content Markers

To add custom content to any tool's documentation, insert MDX comment blocks with section markers:

```markdown
{/_ MANUAL-CONTENT-START:sectionName _/}
Your custom content here (Markdown formatting supported)
{/_ MANUAL-CONTENT-END _/}
```

Replace `sectionName` with one of the supported section names:

- `intro` - Content at the top of the document after the BlockInfoCard
- `usage` - Additional usage instructions and examples
- `configuration` - Custom configuration details
- `outputs` - Additional output information or examples
- `notes` - Extra notes at the end of the document

### Example

To add custom examples to a tool doc:

````markdown
{/_ MANUAL-CONTENT-START:usage _/}

## Examples

### Basic Usage

```json
{
  "parameter": "value",
  "anotherParameter": "anotherValue"
}
```
````

### Advanced Configuration

Here's how to use this tool for a specific use case...
{/_ MANUAL-CONTENT-END _/}

```

When the documentation is regenerated, your manual content will be preserved in the appropriate section automatically. The script will not add any placeholders or markers to files by default.
```
