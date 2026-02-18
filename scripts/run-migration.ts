/**
 * Script: Run Migration 003 - Add gateway_id to cron_jobs
 * 
 * Usage: npx tsx scripts/run-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const MIGRATION_SQL = `
-- Add gateway_id column
ALTER TABLE cron_jobs 
ADD COLUMN IF NOT EXISTS gateway_id text UNIQUE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cron_jobs_gateway_id ON cron_jobs(gateway_id);
`;

async function runMigration() {
  console.log('🔄 Running Migration 003: Add gateway_id');
  console.log('━'.repeat(50));

  // Use Supabase REST API to check if column exists
  const supabase = await import('@supabase/supabase-js');
  const client = supabase.createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Try to insert a test record with gateway_id to see if column exists
  const { error: testError } = await client
    .from('cron_jobs')
    .select('gateway_id')
    .limit(1);

  if (testError && testError.message.includes('column "gateway_id" does not exist')) {
    console.log('⚠️  Column gateway_id does not exist.');
    console.log('');
    console.log('📋 MANUAL ACTION REQUIRED:');
    console.log('');
    console.log('1. Open Supabase Dashboard → SQL Editor');
    console.log('2. Execute the following SQL:');
    console.log('');
    console.log(MIGRATION_SQL);
    console.log('');
    console.log('━'.repeat(50));
    return { success: false, reason: 'manual_migration_required' };
  }

  console.log('✅ Column gateway_id already exists or migration completed');
  
  // Verify
  const { data, error } = await client
    .from('cron_jobs')
    .select('id, name, gateway_id')
    .limit(5);

  if (error) {
    console.error('❌ Verification failed:', error.message);
    return { success: false };
  }

  console.log(`📊 Current cron_jobs: ${data?.length || 0} records`);
  data?.forEach(job => {
    console.log(`   - ${job.name} (gateway_id: ${job.gateway_id || 'null'})`);
  });

  return { success: true };
}

runMigration().then(result => {
  if (!result.success) {
    process.exit(1);
  }
});
