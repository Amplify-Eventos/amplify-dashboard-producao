/**
 * sync-cron-runs.ts
 * Syncs Gateway cron run state to Supabase
 * 
 * This script bridges the gap between Gateway's in-memory cron state
 * and Supabase's cron_runs table for observability.
 * 
 * Usage: npx ts-node scripts/sync-cron-runs.ts [--dry-run]
 * 
 * Part of Phase 2.7: Gateway Cron Integration
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`✅ Loaded env from: ${envPath}`);
} else {
  console.warn(`⚠️ No .env.local found at: ${envPath}`);
}

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Gateway cron storage path
const GATEWAY_CRON_PATH = path.join(process.env.USERPROFILE || '', '.openclaw', 'cron', 'jobs.json');

interface GatewayCronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'cron' | 'every' | 'at';
    expr?: string;
    everyMs?: number;
    tz?: string;
  };
  sessionTarget: 'main' | 'isolated';
  payload: {
    kind: 'agentTurn' | 'systemEvent';
    message?: string;
    text?: string;
  };
  delivery?: {
    mode: string;
  };
  state: {
    lastRunAtMs?: number;
    lastStatus?: 'ok' | 'error' | 'running' | 'timeout';
    lastDurationMs?: number;
    lastError?: string;
    consecutiveErrors?: number;
    nextRunAtMs?: number;
    runningAtMs?: number;
  };
}

interface GatewayCronStorage {
  version: number;
  jobs: GatewayCronJob[];
}

/**
 * Convert Unix timestamp (ms) to ISO string
 */
function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Map Gateway status to database enum
 */
function mapStatus(status?: string): 'pending' | 'running' | 'ok' | 'error' | 'timeout' {
  switch (status) {
    case 'ok': return 'ok';
    case 'error': return 'error';
    case 'running': return 'running';
    case 'timeout': return 'timeout';
    default: return 'pending';
  }
}

/**
 * Sync cron jobs and runs from Gateway to Supabase
 */
async function syncCronRuns(dryRun: boolean = false): Promise<void> {
  console.log('🔄 Cron Runs Sync - Phase 2.7');
  console.log('━'.repeat(50));
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`📁 Gateway path: ${GATEWAY_CRON_PATH}`);
  console.log(`🔍 Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  // Read Gateway cron storage
  if (!fs.existsSync(GATEWAY_CRON_PATH)) {
    console.error('❌ Gateway cron storage not found');
    console.error(`   Expected: ${GATEWAY_CRON_PATH}`);
    process.exit(1);
  }

  const gatewayData: GatewayCronStorage = JSON.parse(
    fs.readFileSync(GATEWAY_CRON_PATH, 'utf-8')
  );

  console.log(`📊 Found ${gatewayData.jobs.length} jobs in Gateway`);
  console.log('');

  const results = {
    jobsUpdated: 0,
    runsCreated: 0,
    skipped: 0,
    errors: 0
  };

  for (const job of gatewayData.jobs) {
    const state = job.state;
    
    if (!state.lastRunAtMs) {
      console.log(`⏭️  ${job.name}: No runs yet, skipping`);
      results.skipped++;
      continue;
    }

    const runTime = msToIso(state.lastRunAtMs);
    const status = mapStatus(state.lastStatus);

    console.log(`📋 ${job.name}`);
    console.log(`   ID: ${job.id}`);
    console.log(`   Last run: ${runTime}`);
    console.log(`   Status: ${status}`);
    console.log(`   Duration: ${state.lastDurationMs || 0}ms`);
    
    if (state.lastError) {
      console.log(`   Error: ${state.lastError}`);
    }

    if (dryRun) {
      console.log(`   [DRY RUN] Would sync to Supabase`);
      continue;
    }

    try {
      // 1. Upsert the cron job definition
      const { error: jobError } = await supabase
        .from('cron_jobs')
        .upsert({
          id: job.id,
          name: job.name,
          enabled: job.enabled,
          schedule_kind: job.schedule.kind,
          schedule_expr: job.schedule.expr || String(job.schedule.everyMs || 0),
          timezone: job.schedule.tz || 'America/Sao_Paulo',
          session_target: job.sessionTarget,
          payload: job.payload as any,
          delivery: job.delivery as any,
          last_run_at: state.lastRunAtMs ? runTime : null,
          last_status: status,
          last_duration_ms: state.lastDurationMs || null,
          last_error: state.lastError || null,
          consecutive_errors: state.consecutiveErrors || 0,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (jobError) {
        console.error(`   ❌ Job upsert failed: ${jobError.message}`);
        results.errors++;
        continue;
      }

      results.jobsUpdated++;
      console.log(`   ✅ Job synced`);

      // 2. Check if this run already exists
      const { data: existingRun } = await supabase
        .from('cron_runs')
        .select('id')
        .eq('job_id', job.id)
        .eq('started_at', runTime)
        .single();

      if (existingRun) {
        console.log(`   ⏭️  Run already exists, skipping`);
        continue;
      }

      // 3. Create the run record
      const { error: runError } = await supabase
        .from('cron_runs')
        .insert({
          job_id: job.id,
          started_at: runTime,
          completed_at: state.lastRunAtMs ? msToIso(state.lastRunAtMs + (state.lastDurationMs || 0)) : null,
          status,
          duration_ms: state.lastDurationMs || null,
          error_message: state.lastError || null,
          result_summary: null
        });

      if (runError) {
        console.error(`   ❌ Run insert failed: ${runError.message}`);
        results.errors++;
        continue;
      }

      results.runsCreated++;
      console.log(`   ✅ Run created`);

    } catch (error) {
      console.error(`   ❌ Sync error: ${error}`);
      results.errors++;
    }

    console.log('');
  }

  // Summary
  console.log('━'.repeat(50));
  console.log('📊 SYNC SUMMARY');
  console.log(`   Jobs updated: ${results.jobsUpdated}`);
  console.log(`   Runs created: ${results.runsCreated}`);
  console.log(`   Skipped: ${results.skipped}`);
  console.log(`   Errors: ${results.errors}`);
  console.log('');
  console.log(results.errors === 0 ? '✅ Sync complete' : '⚠️ Sync completed with errors');
}

// Run the sync
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

syncCronRuns(dryRun)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
