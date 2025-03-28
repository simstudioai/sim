import {
    CopilotRuntime,
    ExperimentalEmptyAdapter,
    copilotRuntimeNextJSAppRouterEndpoint,
    langGraphPlatformEndpoint
} from "@copilotkit/runtime";;
import { NextRequest } from "next/server";

// You can use any service adapter here for multi-agent support.
const serviceAdapter = new ExperimentalEmptyAdapter();

const runtime = new CopilotRuntime({
    remoteEndpoints: [
        langGraphPlatformEndpoint({
            deploymentUrl: `${process.env.AGENT_DEPLOYMENT_URL || 'http://localhost:8123'}`,
            langsmithApiKey: process.env.LANGSMITH_API_KEY,
            agents: [
                {
                    name: 'sim_agent', 
                    description: 'A helpful LLM agent.',
                }
            ]
        }),
    ],
});

export const POST = async (req: NextRequest) => {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        runtime,
        serviceAdapter,
        endpoint: "/api/copilotkit",
    });

    return handleRequest(req);
};