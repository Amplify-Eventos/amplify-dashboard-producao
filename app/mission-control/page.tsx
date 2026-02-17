import { getAgents, getTasks } from '@/lib/supabase-client';
import MissionControlClient from './MissionControlClient';

export const revalidate = 10; // Revalidate every 10 seconds

export default async function MissionControl() {
  const [agents, tasks] = await Promise.all([
    getAgents(),
    getTasks()
  ]);

  // Calculate stats
  const activeAgents = agents.filter(a => a.status === 'working').length;
  const pendingTasks = tasks.filter(t => t.status !== 'done').length;
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;

  return (
    <MissionControlClient
      agents={agents}
      tasks={tasks}
      stats={{
        activeAgents,
        totalAgents: agents.length,
        pendingTasks,
        completedTasks,
        inProgressTasks,
        totalTasks: tasks.length
      }}
    />
  );
}
