-- Migration 003: Add gateway_id to cron_jobs
-- Links Gateway cron jobs to Supabase cron_jobs for persistence
-- Author: Backend Architect
-- Date: 2026-02-17

-- Add gateway_id column
ALTER TABLE cron_jobs 
ADD COLUMN IF NOT EXISTS gateway_id text UNIQUE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cron_jobs_gateway_id ON cron_jobs(gateway_id);

-- Comment
COMMENT ON COLUMN cron_jobs.gateway_id IS 'ID of the corresponding job in the Gateway cron scheduler';
