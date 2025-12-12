"""
Example: Upload files with workflow execution

This example demonstrates how to upload files when executing a workflow.
Files are automatically detected and converted to base64 format.
"""

from simstudio import SimStudioClient
import os


def main():
    # Initialize the client
    api_key = os.getenv('SIM_API_KEY')
    if not api_key:
        raise ValueError('SIM_API_KEY environment variable is required')

    client = SimStudioClient(api_key=api_key)

    # Example 1: Upload a single file
    # Include file under the field name from your workflow's API trigger input format
    print("Example 1: Upload a single file")
    with open('document.pdf', 'rb') as f:
        result = client.execute_workflow(
            workflow_id='your-workflow-id',
            input_data={
                'documents': [f],  # Field name must match your API trigger's file input field
                'instructions': 'Analyze this document'
            }
        )

    if result.success:
        print(f"Success! Output: {result.output}")
    else:
        print(f"Failed: {result.error}")

    # Example 2: Upload multiple files
    print("\nExample 2: Upload multiple files")
    with open('document1.pdf', 'rb') as f1, open('document2.pdf', 'rb') as f2:
        result = client.execute_workflow(
            workflow_id='your-workflow-id',
            input_data={
                'attachments': [f1, f2],  # Field name must match your API trigger's file input field
                'query': 'Compare these documents'
            }
        )

    if result.success:
        print(f"Success! Output: {result.output}")
    else:
        print(f"Failed: {result.error}")


if __name__ == '__main__':
    main()
