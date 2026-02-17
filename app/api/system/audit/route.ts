import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/system/audit
 * Audits the entire system for integrity
 * 
 * Returns: {
 *   integrity: 'OK' | 'CRITICAL' | 'WARNING',
 *   agents: { total, active, stalled },
 *   tasks: { total, pending, inProgress, done },
 *   recentActivity: TaskHistory[],
 *   issues: string[]
 * }
 */
export async function GET() {
  try {
    const issues: string[] = [];
    let integrity: 'OK' | 'CRITICAL' | 'WARNING' = 'OK';

    // 1. Check agents
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, name, status, last_heartbeat');

    if (agentsError) {
      issues.push('Failed to fetch agents');
      integrity = 'CRITICAL';
    }

    const now = Date.now();
    const FIFTEEN_MINUTES = 15 * 60 * 1000;

    const stalledAgents = (agents || []).filter(a => {
      if (!a.last_heartbeat) return true;
      const lastBeat = new Date(a.last_heartbeat).getTime();
      return (now - lastBeat) > FIFTEEN_MINUTES;
    });

    if (stalledAgents.length > 0) {
      issues.push(`${stalledAgents.length} agents have stale heartbeats`);
      integrity = 'WARNING';
    }

    // 2. Check task_history (proof of agent activity)
    const { data: recentHistory, error: historyError } = await supabase
      .from('task_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (historyError) {
      issues.push('Failed to fetch task_history');
    }

    const recentAgentActivity = (recentHistory || []).filter(h => 
      h.action?.startsWith('agent_')
    );

    if (recentAgentActivity.length === 0) {
      issues.push('No agent activity recorded in task_history');
      integrity = 'CRITICAL';
    }

    // 3. Check agent_memory
    const { data: recentMemory, error: memoryError } = await supabase
      .from('agent_memory')
      .select('id')
      .limit(1);

    if (memoryError) {
      issues.push('Failed to access agent_memory table');
    }

    if (!recentMemory || recentMemory.length === 0) {
      issues.push('No agent_memory entries found - agents may not be saving to Supabase');
      integrity = 'WARNING';
    }

    // 4. Check tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('id, status');

    if (tasksError) {
      issues.push('Failed to fetch tasks');
      integrity = 'CRITICAL';
    }

    const taskStats = {
      total: tasks?.length || 0,
      backlog: tasks?.filter(t => t.status === 'backlog').length || 0,
      todo: tasks?.filter(t => t.status === 'todo').length || 0,
      inProgress: tasks?.filter(t => t.status === 'in_progress').length || 0,
      done: tasks?.filter(t => t.status === 'done').length || 0
    };

    // 5. Generate report
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      integrity,
      agents: {
        total: agents?.length || 0,
        active: agents?.filter(a => a.status === 'working').length || 0,
        idle: agents?.filter(a => a.status === 'idle').length || 0,
        stalled: stalledAgents.length,
        details: stalledAgents.map(a => ({
          id: a.id,
          name: a.name,
          lastHeartbeat: a.last_heartbeat
        }))
      },
      tasks: taskStats,
      recentActivity: recentHistory?.slice(0, 10) || [],
      issues,
      recommendation: integrity === 'CRITICAL' 
        ? 'Agents are not using Supabase. Ensure all heartbeats call /api/agents/wake and /api/agents/report'
        : integrity === 'WARNING'
        ? 'Some agents may be disconnected. Check stalled agents.'
        : 'System operating normally.'
    });

  } catch (error) {
    console.error('Audit API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
