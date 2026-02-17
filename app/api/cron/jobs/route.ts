import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/cron/jobs
 * Get all cron jobs from Supabase
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('cron_jobs')
      .select('*')
      .order('name');

    if (error) {
      console.error('Failed to fetch cron jobs:', error);
      return NextResponse.json(
        { error: 'Failed to fetch cron jobs' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      jobs: data || []
    });
  } catch (error) {
    console.error('Cron jobs GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/jobs
 * Sync Gateway cron jobs to Supabase
 * Called when the Gateway starts or jobs are updated
 * 
 * Body: { jobs: CronJobInput[] }
 */
export async function POST(request: Request) {
  try {
    const { jobs } = await request.json();

    if (!Array.isArray(jobs)) {
      return NextResponse.json(
        { error: 'jobs array is required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const results = {
      synced: 0,
      errors: 0
    };

    for (const job of jobs) {
      const { error } = await supabase
        .from('cron_jobs')
        .upsert({
          id: job.id,
          name: job.name,
          enabled: job.enabled ?? true,
          schedule_kind: job.schedule?.kind || 'cron',
          schedule_expr: job.schedule?.expr || job.schedule?.everyMs?.toString() || '* * * * *',
          timezone: job.schedule?.tz || 'America/Sao_Paulo',
          session_target: job.sessionTarget || 'isolated',
          payload: job.payload || {},
          delivery: job.delivery || null,
          last_run_at: job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : null,
          last_status: job.state?.lastStatus || null,
          last_duration_ms: job.state?.lastDurationMs || null,
          last_error: job.state?.lastError || null,
          consecutive_errors: job.state?.consecutiveErrors || 0,
          updated_at: now
        }, { onConflict: 'id' });

      if (error) {
        console.error(`Failed to sync job ${job.name}:`, error);
        results.errors++;
      } else {
        results.synced++;
      }
    }

    return NextResponse.json({
      success: true,
      ...results
    });

  } catch (error) {
    console.error('Cron jobs sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
