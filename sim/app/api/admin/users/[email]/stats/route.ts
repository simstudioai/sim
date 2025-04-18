import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'

// Create a logger for this module
const logger = createLogger('UserStatsAPI')

// Define interfaces based on DB schema
interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Block {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: any;
}

interface WorkflowState {
  blocks: Block[];
  [key: string]: any;
}

interface Workflow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  state: WorkflowState;
  color: string;
  lastSynced: Date;
  createdAt: Date;
  updatedAt: Date;
  isDeployed: boolean;
  deployedState: any;
  deployedAt: Date | null;
  collaborators: string[];
  runCount: number;
  lastRunAt: Date | null;
  variables: Record<string, any>;
}

export async function GET(
  request: Request,
  { params }: { params: { email: string } }
) {
  try {
    // Get the user by email
    const users = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, params.email));

    if (!users || users.length === 0) {
      return Response.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const user = users[0] as User;

    // Get all workflows for this user
    const workflowsResult = await db
      .select()
      .from(schema.workflow)
      .where(eq(schema.workflow.userId, user.id));
      
    // Cast to our Workflow interface
    const workflows = workflowsResult.map(w => ({
      ...w,
      state: w.state as WorkflowState
    })) as Workflow[];

    // Calculate statistics
    const workflowCount = workflows.length;
    const blockCount = workflows.reduce((total, workflow) => {
      // Safely access blocks with proper type checking
      return total + (workflow.state?.blocks?.length || 0);
    }, 0);

    // Get execution statistics from logs
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(
        eq(schema.workflowLogs.level, "execution")
      );

    const userLogs = logs.filter(log => {
      const workflowId = log.workflowId;
      return workflows.some(workflow => workflow.id === workflowId);
    });

    const executionCount = userLogs.length;
    
    // Filter successful executions
    const successfulExecutions = userLogs.filter(log => {
      try {
        const metadata = log.metadata as any;
        return metadata?.status === "success";
      } catch (e) {
        return false;
      }
    }).length;
    
    const successRate = executionCount > 0 
      ? (successfulExecutions / executionCount) * 100 
      : 0;

    // Get user stats to retrieve total cost
    const userStatsResult = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, user.id));

    const totalCost = userStatsResult.length > 0 
      ? parseFloat(userStatsResult[0].totalCost as string) || 0 
      : 0;

    // Return the user stats
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      workflows: workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        blockCount: workflow.state?.blocks?.length || 0,
        createdAt: workflow.createdAt
      })),
      stats: {
        workflowCount,
        blockCount,
        executionCount,
        successfulExecutions,
        successRate,
        totalCost
      }
    });
  } catch (error) {
    logger.error("Error fetching user stats", error);
    return Response.json(
      { error: "Failed to fetch user statistics" },
      { status: 500 }
    );
  }
} 