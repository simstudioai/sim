from typing_extensions import Literal, TypedDict, Dict, List, Any, Union, Optional
from langchain_openai import ChatOpenAI
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command
from copilotkit import CopilotKitState
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
import os

class StdioConnection(TypedDict):
    command: str
    args: List[str]
    transport: Literal["stdio"]

class SSEConnection(TypedDict):
    url: str
    transport: Literal["sse"]

MCPConfig = Dict[str, Union[StdioConnection, SSEConnection]]

class AgentState(CopilotKitState):

    mcp_config: Optional[MCPConfig]


DEFAULT_MCP_CONFIG: MCPConfig = {
    "math": {
        "command": "python",
        "args": [os.path.join(os.path.dirname(__file__), "..", "math_server.py")],
        "transport": "stdio",
    },

}

async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["__end__"]]:

    mcp_config = state.get("mcp_config", DEFAULT_MCP_CONFIG)

    print(f"mcp_config: {mcp_config}, default: {DEFAULT_MCP_CONFIG}")
    
    async with MultiServerMCPClient(mcp_config) as mcp_client:
        mcp_tools = mcp_client.get_tools()
        
        model = ChatOpenAI(model="gpt-4o-mini")
        react_agent = create_react_agent(model, mcp_tools)
        
        agent_input = {
            "messages": state["messages"]
        }
        
        agent_response = await react_agent.ainvoke(agent_input)
        
        updated_messages = state["messages"] + agent_response.get("messages", [])
        
        return Command(
            goto=END,
            update={"messages": updated_messages},
        )

workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.set_entry_point("chat_node")

graph = workflow.compile(MemorySaver())