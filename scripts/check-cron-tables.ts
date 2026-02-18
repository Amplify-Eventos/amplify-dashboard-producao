import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load env
config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkCronTables() {
  console.log('=== CRON TABLES STATUS ===\n');
  
  // Check cron_jobs
  const { data: jobs, error: jobsError, count: jobsCount } = await supabase
    .from('cron_jobs')
    .select('id,name,enabled,schedule_kind,schedule_expr', { count: 'exact' });
  
  if (jobsError) {
    console.log('CRON_JOBS ERROR:', jobsError.message);
  } else {
    console.log('CRON_JOBS:', jobsCount, 'records');
    jobs?.forEach(j => console.log(`  - ${j.name} (enabled: ${j.enabled})`));
  }
  
  // Check cron_runs
  const { data: runs, error: runsError, count: runsCount } = await supabase
    .from('cron_runs')
    .select('id,job_id,status,started_at', { count: 'exact' })
    .limit(5);
  
  if (runsError) {
    console.log('\nCRON_RUNS ERROR:', runsError.message);
  } else {
    console.log('\nCRON_RUNS:', runsCount, 'records');
    if (runs && runs.length > 0) {
      runs.forEach(r => console.log(`  - ${r.status} at ${r.started_at}`));
    }
  }

  // Check agents table
  const { count: agentsCount } = await supabase
    .from('agents')
    .select('*', { count: 'exact', head: true });
  console.log('\nAGENTS:', agentsCount, 'records');

  // Check tasks table
  const { count: tasksCount } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true });
  console.log('TASKS:', tasksCount, 'records');
}

checkCronTables();
