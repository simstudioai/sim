# Stagehand Integration for Sim Studio

This integration allows you to use [Stagehand](https://docs.stagehand.dev/) to extract structured data from webpages using Browserbase and OpenAI.

## Overview

Stagehand is a powerful browser automation and extraction tool that allows you to interact with webpages and extract structured data using natural language instructions. This integration provides a Sim Studio block that leverages the Stagehand SDK with Browserbase to extract data according to a schema you define.

## Architecture

This integration uses Stagehand with Browserbase:

1. The UI block collects the necessary parameters (URL, instruction, schema, etc.)
2. The tool sends these parameters to a Next.js API route
3. The API route uses Stagehand with Browserbase to navigate to the URL and extract the data
4. The extracted data is returned to the frontend

## Setup

1. Make sure you have the following environment variables configured:

   - `BROWSERBASE_API_KEY`: Your Browserbase API key
   - `BROWSERBASE_PROJECT_ID`: Your Browserbase project ID
   - You also need to provide an OpenAI API key when using the block

2. Add the Stagehand block to your workflow.

3. Configure the extraction with:
   - **URL**: The webpage to extract data from
   - **Instruction**: Describe what data you want to extract in natural language
   - **Schema**: Define the structure of the data using JSON Schema
   - **API Key**: Your OpenAI API key for the LLM extraction
   - Optional parameters:
     - **Use Text Extract**: Convert the page to text for cleaner extraction
     - **Selector**: XPath selector to reduce the scope of extraction

## Example

Here's an example of extracting product information from an e-commerce page:

```json
{
  "type": "object",
  "properties": {
    "products": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "The name of the product"
          },
          "price": {
            "type": "string",
            "description": "The price of the product in text format"
          },
          "rating": {
            "type": "string",
            "description": "The user rating out of 5 stars"
          }
        }
      }
    }
  }
}
```

With the instruction:

```
Extract all products shown on the page, including their name, price, and user rating.
```

## Resources

- [Stagehand Documentation](https://docs.stagehand.dev/)
- [Stagehand in Next.js](https://docs.stagehand.dev/examples/nextjs)
- [Stagehand Extract Reference](https://docs.stagehand.dev/reference/extract)
- [Browserbase Documentation](https://docs.browserbase.io/)
