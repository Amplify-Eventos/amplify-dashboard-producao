import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Cron run status type matching the database enum
type CronRunStatus = 'pending' | 'running' | 'ok' | 'error' | 'timeout';

interface CronRunRequest {
  jobId: string;
  jobName: string;
  startedAt: string;
  completedAt?: string;
  status: CronRunStatus;
  durationMs?: number;
  errorMessage?: string;
  resultSummary?: string;
}

/**
 * GET /api/cron/runs
 * Get cron run history from Supabase
 * Query params: jobId (optional), limit (default 50)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const limit = parseInt(searchParams.get('limit') || '50');

  try {
    let query = supabase
      .from('cron_runs')
      .select(`
        *,
        cron_job:cron_jobs(id, name, enabled)
      `)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (jobId) {
      query = query.eq('job_id', jobId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch cron runs:', error);
      return NextResponse.json(
        { error: 'Failed to fetch cron runs' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      runs: data || []
    });
  } catch (error) {
    console.error('Cron runs GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/runs
 * Record a cron job run to Supabase
 * 
 * Body: CronRunRequest
 * Returns: { success: boolean, runId: string }
 */
export async function POST(request: Request) {
  try {
    const body: CronRunRequest = await request.json();
    const { jobId, jobName, startedAt, completedAt, status, durationMs, errorMessage, resultSummary } = body;

    if (!jobId || !jobName || !startedAt || !status) {
      return NextResponse.json(
        { error: 'jobId, jobName, startedAt, and status are required' },
        { status: 400 }
      );
    }

    // 1. Ensure the cron job exists in the database
    const { data: existingJob, error: jobCheckError } = await supabase
      .from('cron_jobs')
      .select('id')
      .eq('id', jobId)
      .single();

    if (jobCheckError || !existingJob) {
      // Create the job if it doesn't exist
      const { error: createJobError } = await supabase
        .from('cron_jobs')
        .insert({
          id: jobId,
          name: jobName,
          enabled: true,
          schedule_kind: 'cron', // Default, will be updated by sync
          schedule_expr: '* * * * *', // Default, will be updated by sync
          payload: {},
          last_run_at: startedAt,
          last_status: status,
          last_duration_ms: durationMs || null,
          last_error: errorMessage || null,
          consecutive_errors: status === 'error' ? 1 : 0
        });

      if (createJobError) {
        console.error('Failed to create cron job:', createJobError);
        // Continue anyway - we'll try to create the run
      }
    }

    // 2. Create the run record
    const { data: run, error: runError } = await supabase
      .from('cron_runs')
      .insert({
        job_id: jobId,
        started_at: startedAt,
        completed_at: completedAt || null,
        status,
        duration_ms: durationMs || null,
        error_message: errorMessage || null,
        result_summary: resultSummary || null
      })
      .select('id')
      .single();

    if (runError) {
      console.error('Failed to create cron run:', runError);
      return NextResponse.json(
        { error: 'Failed to create cron run' },
        { status: 500 }
      );
    }

    // 3. Update the job's last run info
    await supabase
      .from('cron_jobs')
      .update({
        last_run_at: startedAt,
        last_status: status,
        last_duration_ms: durationMs || null,
        last_error: errorMessage || null,
        consecutive_errors: status === 'error' 
          ? supabase.rpc('increment_consecutive_errors', { job_id: jobId })
          : 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    return NextResponse.json({
      success: true,
      runId: run?.id
    });

  } catch (error) {
    console.error('Cron runs POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
