import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Agent ID to cron job name mapping (must match cron_jobs.name in Supabase)
const AGENT_CRON_MAP: Record<string, string> = {
  '60569bb5-8542-459f-ba78-d302d506634e': 'Pulse Heartbeat',
  'a652a950-e1e4-4207-8376-f111985976a0': 'Backend Architect Heartbeat',
  'a989b59b-8413-4990-b343-9b6cfb42516e': 'Frontend/Product Heartbeat',  // Matches DB
  '9d5f29c9-d771-431e-9442-93cd5d37da80': 'Growth Agent Daily Audit',     // Matches DB
  'acb23908-a751-43a7-bf89-1c5452ec5464': 'System Admin Heartbeat',
  'c7e8f9a0-1234-4567-89ab-cdef12345678': 'Content Strategist Heartbeat'
};

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
 *   tasksStarted?: string[],
 *   cronRunId?: string,        // Optional: ID of the cron run to update
 *   cronStartedAt?: string     // Optional: When the cron run started
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
      tasksStarted = [],
      cronRunId,
      cronStartedAt
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

    // 2. Save to agent_memory (using actual schema with 'content' field)
    const { error: memoryError } = await supabase
      .from('agent_memory')
      .insert({
        agent_id: agentId,
        memory_type: 'heartbeat_report',
        key: `heartbeat_${Date.now()}`,
        content: JSON.stringify({
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

    // 3. Log report event (using actual schema)
    await supabase
      .from('task_history')
      .insert({
        task_id: null,
        agent_id: agentId,
        action: 'agent_report',
        note: summary
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
          note: `Task completed at ${now}`
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
          note: `Task started at ${now}`
        });
    }

    // 6. Log cron run if this was triggered by a cron job
    const cronJobName = AGENT_CRON_MAP[agentId];
    let cronRunLogged = false;

    if (cronJobName) {
      try {
        // Find the cron job by name
        const { data: cronJob } = await supabase
          .from('cron_jobs')
          .select('id')
          .eq('name', cronJobName)
          .single();

        if (cronJob) {
          const startedAt = cronStartedAt || now;
          const durationMs = cronStartedAt 
            ? Date.now() - new Date(cronStartedAt).getTime() 
            : null;
          
          // Determine run status
          const runStatus = summary.toLowerCase().includes('error') 
            ? 'error' 
            : summary.toLowerCase().includes('timeout')
              ? 'timeout'
              : 'ok';

          // Create cron run record
          const { error: runError } = await supabase
            .from('cron_runs')
            .insert({
              job_id: cronJob.id,
              started_at: startedAt,
              completed_at: now,
              status: runStatus,
              duration_ms: durationMs,
              result_summary: summary.substring(0, 500) // Truncate for storage
            });

          if (runError) {
            console.error('Failed to log cron run:', runError);
          } else {
            cronRunLogged = true;

            // Update the job's last run info
            await supabase
              .from('cron_jobs')
              .update({
                last_run_at: now,
                last_status: runStatus,
                last_duration_ms: durationMs,
                updated_at: now
              })
              .eq('id', cronJob.id);
          }
        }
      } catch (cronError) {
        console.error('Cron run logging error:', cronError);
        // Don't fail the whole request if cron logging fails
      }
    }

    return NextResponse.json({
      success: true,
      agentId,
      status: 'idle',
      timestamp: now,
      tasksCompleted: tasksCompleted.length,
      tasksStarted: tasksStarted.length,
      cronRunLogged
    });

  } catch (error) {
    console.error('Report API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
