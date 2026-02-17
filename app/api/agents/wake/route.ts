import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Service role for write access
);

/**
 * POST /api/agents/wake
 * Called when an agent wakes up to register heartbeat and load assigned tasks
 * 
 * Body: { agentId: string, agentName: string }
 * Returns: { success: boolean, tasks: Task[], memory: MemoryEntry[] }
 */
export async function POST(request: Request) {
  try {
    const { agentId, agentName } = await request.json();

    if (!agentId || !agentName) {
      return NextResponse.json(
        { error: 'agentId and agentName required' },
        { status: 400 }
      );
    }

    // 1. Update agent heartbeat
    const now = new Date().toISOString();
    const { error: agentError } = await supabase
      .from('agents')
      .upsert({
        id: agentId,
        name: agentName,
        status: 'working',
        last_heartbeat: now,
        updated_at: now
      }, { onConflict: 'id' });

    if (agentError) {
      console.error('Failed to update agent:', agentError);
      return NextResponse.json(
        { error: 'Failed to update agent' },
        { status: 500 }
      );
    }

    // 2. Load assigned tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_agent_id', agentId)
      .neq('status', 'done')
      .order('priority', { ascending: false });

    if (tasksError) {
      console.error('Failed to load tasks:', tasksError);
    }

    // 3. Load recent memory
    const { data: memory, error: memoryError } = await supabase
      .from('agent_memory')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (memoryError) {
      console.error('Failed to load memory:', memoryError);
    }

    // 4. Log wake event to task_history
    await supabase
      .from('task_history')
      .insert({
        task_id: null, // System event, not task-specific
        agent_id: agentId,
        action: 'agent_wake',
        details: JSON.stringify({ agentName, timestamp: now })
      });

    return NextResponse.json({
      success: true,
      agentId,
      status: 'working',
      lastHeartbeat: now,
      tasks: tasks || [],
      memory: memory || []
    });

  } catch (error) {
    console.error('Wake API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
