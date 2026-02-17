import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { AgentStatus } from '@/lib/supabase-client';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';

// GET /api/agents - Fetch all agents
export async function GET() {
  const { data, error } = await supabaseServer
    .from('agents')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PATCH /api/agents - Update agent status
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, status } = body;

    if (!agentId || !status) {
      return NextResponse.json({ error: 'agentId and status are required' }, { status: 400 });
    }

    // Validate status
    const validStatuses: AgentStatus[] = ['idle', 'working', 'offline', 'error'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from('agents')
      .update({ 
        status, 
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString() 
      })
      .eq('id', agentId);

    if (error) {
      console.error('Error updating agent:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Agent updated successfully' });
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
