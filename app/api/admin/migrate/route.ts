import { NextResponse } from 'next/server';

// This endpoint runs migrations - should be protected in production
export async function POST(request: Request) {
  try {
    const { connectionString } = await request.json().catch(() => ({}));

    // Use the connection string from env if not provided
    const connStr = connectionString || process.env.POSTGRES_URL;

    if (!connStr) {
      return NextResponse.json(
        { error: 'No database connection string available' },
        { status: 500 }
      );
    }

    // Dynamic import of pg (only on server)
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: connStr });

    const client = await pool.connect();

    try {
      // Check if uuid-ossp extension exists
      await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

      // Create task_history table
      await client.query(`
        CREATE TABLE IF NOT EXISTS task_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
          agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          details JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes
      await client.query(`CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_task_history_agent ON task_history(agent_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_task_history_created ON task_history(created_at DESC)`);

      // Create agent_memory table
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_memory (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
          memory_type TEXT,
          key TEXT,
          value JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes
      await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_memory_created ON agent_memory(created_at DESC)`);

      // Create system_events table
      await client.query(`
        CREATE TABLE IF NOT EXISTS system_events (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          type TEXT NOT NULL,
          agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
          data JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(type)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at DESC)`);

      return NextResponse.json({
        success: true,
        message: 'Migration completed successfully',
        tables: ['task_history', 'agent_memory', 'system_events']
      });

    } finally {
      client.release();
      await pool.end();
    }

  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}
