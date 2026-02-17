import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/agents/report
 * Called when an agent completes work to save results to Supabase
 * 
 * Body: { 
 *   agentId: string, 
 *   summary: string,
 *   findings?: string[],
 *   blockers?: string[],
 *   tasksCompleted?: string[],
 *   tasksStarted?: string[]
 * }
 */
export async function POST(request: Request) {
  try {
    const {
      agentId,
      summary,
      findings = [],
      blockers = [],
      tasksCompleted = [],
      tasksStarted = []
    } = await request.json();

    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // 1. Update agent status to idle
    const { error: agentError } = await supabase
      .from('agents')
      .update({
        status: 'idle',
        last_heartbeat: now,
        updated_at: now
      })
      .eq('id', agentId);

    if (agentError) {
      console.error('Failed to update agent:', agentError);
    }

    // 2. Save to agent_memory
    const { error: memoryError } = await supabase
      .from('agent_memory')
      .insert({
        agent_id: agentId,
        memory_type: 'heartbeat_report',
        key: `heartbeat_${Date.now()}`,
        value: JSON.stringify({
          summary,
          findings,
          blockers,
          tasksCompleted,
          tasksStarted,
          timestamp: now
        })
      });

    if (memoryError) {
      console.error('Failed to save memory:', memoryError);
    }

    // 3. Log report event
    await supabase
      .from('task_history')
      .insert({
        task_id: null,
        agent_id: agentId,
        action: 'agent_report',
        details: JSON.stringify({ summary, timestamp: now })
      });

    // 4. Update tasks that were completed
    for (const taskId of tasksCompleted) {
      await supabase
        .from('tasks')
        .update({ status: 'done', updated_at: now })
        .eq('id', taskId);

      await supabase
        .from('task_history')
        .insert({
          task_id: taskId,
          agent_id: agentId,
          action: 'completed',
          details: JSON.stringify({ completedAt: now })
        });
    }

    // 5. Update tasks that were started
    for (const taskId of tasksStarted) {
      await supabase
        .from('tasks')
        .update({ status: 'in_progress', updated_at: now })
        .eq('id', taskId);

      await supabase
        .from('task_history')
        .insert({
          task_id: taskId,
          agent_id: agentId,
          action: 'started',
          details: JSON.stringify({ startedAt: now })
        });
    }

    return NextResponse.json({
      success: true,
      agentId,
      status: 'idle',
      timestamp: now,
      tasksCompleted: tasksCompleted.length,
      tasksStarted: tasksStarted.length
    });

  } catch (error) {
    console.error('Report API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
