import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { TaskStatus, TaskPriority } from '@/lib/supabase-client';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';

// GET /api/tasks - Fetch all tasks grouped by status
export async function GET() {
  const { data, error } = await supabaseServer
    .from('tasks')
    .select(`
      *,
      assigned_agent:agents(id, name, role, status)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by status for backward compatibility
  const grouped = {
    backlog: data?.filter(t => t.status === 'backlog') || [],
    inProgress: data?.filter(t => t.status === 'in_progress') || [],
    done: data?.filter(t => t.status === 'done') || [],
    todo: data?.filter(t => t.status === 'todo') || [],
  };

  return NextResponse.json({
    ...grouped,
    all: data
  });
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Find agent by name if owner is specified
    let assignedAgentId = null;
    if (body.owner) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .ilike('name', `%${body.owner}%`)
        .single();
      
      if (agent) {
        assignedAgentId = agent.id;
      }
    }

    const { error } = await supabaseServer
      .from('tasks')
      .insert({
        title: body.title,
        description: body.description || null,
        status: 'backlog' as TaskStatus,
        priority: (body.priority as TaskPriority) || 'medium',
        assigned_agent_id: assignedAgentId,
        tags: body.deliverables || null
      });

    if (error) {
      console.error('Error creating task:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Task created successfully' });
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PATCH /api/tasks - Update task (status, priority, assignee, description)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, title, status, priority, assigned_agent_id, description } = body;

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    // Handle status update
    if (status !== undefined) {
      const validStatuses: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ 
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
        }, { status: 400 });
      }
      updates.status = status;
    }

    // Handle priority update
    if (priority !== undefined) {
      const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
      if (!validPriorities.includes(priority)) {
        return NextResponse.json({ 
          error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` 
        }, { status: 400 });
      }
      updates.priority = priority;
    }

    // Handle assignee update
    if (assigned_agent_id !== undefined) {
      updates.assigned_agent_id = assigned_agent_id;
    }

    // Handle description update
    if (description !== undefined) {
      updates.description = description;
    }

    // Need at least one field to update
    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
    }

    // Update by ID or title
    const query = supabaseServer
      .from('tasks')
      .update(updates);

    if (taskId) {
      query.eq('id', taskId);
    } else if (title) {
      query.eq('title', title);
    } else {
      return NextResponse.json({ error: 'taskId or title is required' }, { status: 400 });
    }

    const { error } = await query;

    if (error) {
      console.error('Error updating task:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Task updated successfully' });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/tasks - Delete a task
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('id');

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (error) {
      console.error('Error deleting task:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
