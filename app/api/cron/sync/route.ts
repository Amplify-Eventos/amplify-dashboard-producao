import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Gateway cron job mapping (Gateway job name -> Supabase agent ID)
const AGENT_JOB_MAP: Record<string, string> = {
  'Pulse Heartbeat': '60569bb5-8542-459f-ba78-d302d506634e',
  'Backend Architect Heartbeat': 'a652a950-e1e4-4207-8376-f111985976a0',
  'Frontend Heartbeat': 'a989b59b-8413-4990-b343-9b6cfb42516e',
  'Frontend/Product Heartbeat': 'a989b59b-8413-4990-b343-9b6cfb42516e',
  'Growth Heartbeat': '9d5f29c9-d771-431e-9442-93cd5d37da80',
  'Growth Agent Daily Audit': '9d5f29c9-d771-431e-9442-93cd5d37da80',
  'System Admin Heartbeat': 'acb23908-a751-43a7-bf89-1c5452ec5464',
  'Content Strategist Heartbeat': 'c7e8f9a0-1234-4567-89ab-cdef12345678'
};

interface GatewayJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: string;
    expr?: string;
    everyMs?: number;
    tz?: string;
  };
  sessionTarget: string;
  payload: {
    kind: string;
    message?: string;
    text?: string;
  };
  delivery?: {
    mode: string;
  };
  state?: {
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    lastError?: string;
    consecutiveErrors?: number;
  };
}

/**
 * POST /api/cron/sync
 * Sync Gateway cron jobs to Supabase
 * 
 * Body: { jobs: GatewayJob[] }
 * Returns: { success: boolean, synced: number, created: number, updated: number }
 */
export async function POST(request: Request) {
  try {
    const { jobs } = await request.json() as { jobs: GatewayJob[] };
    
    if (!jobs || !Array.isArray(jobs)) {
      return NextResponse.json(
        { error: 'jobs array required' },
        { status: 400 }
      );
    }

    let synced = 0;
    let created = 0;
    let updated = 0;

    for (const job of jobs) {
      const agentId = AGENT_JOB_MAP[job.name] || null;
      const scheduleExpr = job.schedule.expr || (job.schedule.everyMs ? `${job.schedule.everyMs}ms` : '* * * * *');
      
      // Map Gateway state to our fields
      const lastRunAt = job.state?.lastRunAtMs 
        ? new Date(job.state.lastRunAtMs).toISOString() 
        : null;
      const lastStatus = job.state?.lastStatus || null;
      const lastDurationMs = job.state?.lastDurationMs || null;
      const lastError = job.state?.lastError || null;
      const consecutiveErrors = job.state?.consecutiveErrors || 0;

      // Check if job exists
      const { data: existingJob } = await supabase
        .from('cron_jobs')
        .select('id')
        .eq('gateway_id', job.id)
        .single();

      const jobData = {
        gateway_id: job.id,
        name: job.name,
        enabled: job.enabled,
        schedule_kind: job.schedule.kind,
        schedule_expr: scheduleExpr,
        timezone: job.schedule.tz || 'America/Sao_Paulo',
        session_target: job.sessionTarget,
        agent_id: agentId,
        payload: job.payload,
        delivery: job.delivery,
        last_run_at: lastRunAt,
        last_status: lastStatus,
        last_duration_ms: lastDurationMs,
        last_error: lastError,
        consecutive_errors: consecutiveErrors,
        updated_at: new Date().toISOString()
      };

      if (existingJob) {
        // Update existing job
        const { error } = await supabase
          .from('cron_jobs')
          .update(jobData)
          .eq('gateway_id', job.id);
        
        if (!error) {
          updated++;
          synced++;
        }
      } else {
        // Create new job
        const { error } = await supabase
          .from('cron_jobs')
          .insert({
            ...jobData,
            created_at: new Date().toISOString()
          });
        
        if (!error) {
          created++;
          synced++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      created,
      updated,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Cron sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/sync
 * Get sync status and job mapping
 */
export async function GET() {
  const { data: supabaseJobs, error } = await supabase
    .from('cron_jobs')
    .select('id, gateway_id, name, enabled, last_run_at');

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    agentJobMap: AGENT_JOB_MAP,
    supabaseJobs: supabaseJobs || [],
    timestamp: new Date().toISOString()
  });
}
