#!/usr/bin/env python3
"""
Basic usage examples for the Sim Python SDK
"""

import os

from simstudio import SimStudioClient, SimStudioError


def basic_example():
    """Example 1: Basic workflow execution"""
    client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

    try:
        # Execute a workflow without input
        result = client.execute_workflow("your-workflow-id")

        if result.success:
            print("✅ Workflow executed successfully!")
            print(f"Output: {result.output}")
            if result.metadata:
                print(f"Duration: {result.metadata.get('duration')} ms")
        else:
            print(f"❌ Workflow failed: {result.error}")

    except SimStudioError as error:
        print(f"SDK Error: {error} (Code: {error.code})")
    except Exception as error:
        print(f"Unexpected error: {error}")


def with_input_example():
    """Example 2: Workflow execution with input data"""
    client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

    try:
        result = client.execute_workflow(
            "your-workflow-id",
            input_data={
                "message": "Hello from Python SDK!",
                "user_id": "12345",
                "data": {
                    "type": "analysis",
                    "parameters": {"include_metadata": True, "format": "json"},
                },
            },
            timeout=60.0,  # 60 seconds
        )

        if result.success:
            print("✅ Workflow executed successfully!")
            print(f"Output: {result.output}")
            if result.metadata:
                print(f"Duration: {result.metadata.get('duration')} ms")
        else:
            print(f"❌ Workflow failed: {result.error}")

    except SimStudioError as error:
        print(f"SDK Error: {error} (Code: {error.code})")
    except Exception as error:
        print(f"Unexpected error: {error}")


def status_example():
    """Example 3: Workflow validation and status checking"""
    client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

    try:
        # Check if workflow is ready
        is_ready = client.validate_workflow("your-workflow-id")
        print(f"Workflow ready: {is_ready}")

        # Get detailed status
        status = client.get_workflow_status("your-workflow-id")
        print(
            f"Status: {{\n"
            f"  deployed: {status.is_deployed},\n"
            f"  needs_redeployment: {status.needs_redeployment},\n"
            f"  deployed_at: {status.deployed_at}\n"
            f"}}"
        )

        if status.is_deployed:
            # Execute the workflow
            result = client.execute_workflow("your-workflow-id")
            print(f"Result: {result}")

    except Exception as error:
        print(f"Error: {error}")


def context_manager_example():
    """Example 4: Using context manager"""
    with SimStudioClient(api_key=os.getenv("SIM_API_KEY")) as client:
        try:
            result = client.execute_workflow("your-workflow-id")
            print(f"Result: {result}")
        except Exception as error:
            print(f"Error: {error}")
    # Session is automatically closed here


def batch_execution_example():
    """Example 5: Batch workflow execution"""
    client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

    workflows = [
        ("workflow-1", {"type": "analysis", "data": "sample1"}),
        ("workflow-2", {"type": "processing", "data": "sample2"}),
        ("workflow-3", {"type": "validation", "data": "sample3"}),
    ]

    results = []

    for workflow_id, input_data in workflows:
        try:
            # Validate workflow before execution
            if not client.validate_workflow(workflow_id):
                print(f"⚠️  Skipping {workflow_id}: not deployed")
                continue

            result = client.execute_workflow(workflow_id, input_data)
            results.append(
                {
                    "workflow_id": workflow_id,
                    "success": result.success,
                    "output": result.output,
                    "error": result.error,
                }
            )

            status = "✅ Success" if result.success else "❌ Failed"
            print(f"{status}: {workflow_id}")

        except SimStudioError as error:
            results.append(
                {"workflow_id": workflow_id, "success": False, "error": str(error)}
            )
            print(f"❌ SDK Error in {workflow_id}: {error}")
        except Exception as error:
            results.append(
                {"workflow_id": workflow_id, "success": False, "error": str(error)}
            )
            print(f"❌ Unexpected error in {workflow_id}: {error}")

    # Summary
    successful = sum(1 for r in results if r["success"])
    total = len(results)
    print(f"\n📊 Summary: {successful}/{total} workflows completed successfully")

    return results


def streaming_example():
    """Example 6: Workflow execution with streaming"""
    client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

    try:
        result = client.execute_workflow(
            "your-workflow-id",
            input_data={"message": "Count to five"},
            stream=True,
            selected_outputs=["agent1.content"],  # Use blockName.attribute format
            timeout=60.0,
        )

        if result.success:
            print("✅ Workflow executed successfully!")
            print(f"Output: {result.output}")
            if result.metadata:
                print(f"Duration: {result.metadata.get('duration')} ms")
        else:
            print(f"❌ Workflow failed: {result.error}")

    except SimStudioError as error:
        print(f"SDK Error: {error} (Code: {error.code})")
    except Exception as error:
        print(f"Unexpected error: {error}")


def error_handling_example():
    """Example 7: Comprehensive error handling"""
    client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

    try:
        result = client.execute_workflow("your-workflow-id")

        if result.success:
            print("✅ Workflow executed successfully!")
            print(f"Output: {result.output}")
            return result
        else:
            print(f"❌ Workflow failed: {result.error}")
            return result
    except SimStudioError as error:
        if error.code == "UNAUTHORIZED":
            print("❌ Invalid API key")
        elif error.code == "TIMEOUT":
            print("⏱️  Workflow execution timed out")
        elif error.code == "USAGE_LIMIT_EXCEEDED":
            print("💳 Usage limit exceeded")
        elif error.code == "INVALID_JSON":
            print("📝 Invalid JSON in request body")
        elif error.status == 404:
            print("🔍 Workflow not found")
        elif error.status == 403:
            print("🚫 Workflow is not deployed")
        else:
            print(f"⚠️  Workflow error: {error}")
        raise
    except Exception as error:
        print(f"💥 Unexpected error: {error}")
        raise


if __name__ == "__main__":
    print("🚀 Running Sim Python SDK Examples\n")

    # Check if API key is set
    if not os.getenv("SIM_API_KEY"):
        print("❌ Please set SIM_API_KEY environment variable")
        exit(1)

    try:
        print("1️⃣ Basic Example:")
        basic_example()
        print("\n✅ Basic example completed\n")

        print("2️⃣ Input Example:")
        with_input_example()
        print("\n✅ Input example completed\n")

        print("3️⃣ Status Example:")
        status_example()
        print("\n✅ Status example completed\n")

        print("4️⃣ Context Manager Example:")
        context_manager_example()
        print("\n✅ Context manager example completed\n")

        print("5️⃣ Batch Execution Example:")
        batch_execution_example()
        print("\n✅ Batch execution example completed\n")

        print("6️⃣ Streaming Example:")
        streaming_example()
        print("\n✅ Streaming example completed\n")

        print("7️⃣ Error Handling Example:")
        error_handling_example()
        print("\n✅ Error handling example completed\n")

    except Exception as e:
        print(f"\n💥 Example failed: {e}")
        exit(1)

    print("🎉 All examples completed successfully!")
