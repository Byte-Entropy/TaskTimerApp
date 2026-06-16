export type TaskStatus = 'planned' | 'active' | 'done';

export type Task = {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  dueDate: string;
  priority: number;
  plannedDate: string;
  completedMinutes: number;
  status: TaskStatus;
  createdAt: string;
};

export type PlannerState = {
  activeDate: string;
  tasks: Task[];
  rewardRatio: number;
  activeTaskId: string | null;
  timer: TimerState;
};

export type TimerState = {
  taskId: string | null;
  blockIndex: number;
  remainingSeconds: number;
  status: 'idle' | 'running' | 'paused';
};

export type SessionBlock = {
  type: 'work' | 'break';
  minutes: number;
};

export type SessionPlan = {
  blocks: SessionBlock[];
  rewardMinutes: number;
  totalWorkMinutes: number;
};

export type DayOverview = {
  taskCount: number;
  totalEstimatedMinutes: number;
  rewardMinutes: number;
  urgencyScore: number;
};

export const defaultPlannerState = (): PlannerState => ({
  activeDate: new Date().toISOString().slice(0, 10),
  tasks: [],
  rewardRatio: 0.2,
  activeTaskId: null,
  timer: {
    taskId: null,
    blockIndex: 0,
    remainingSeconds: 0,
    status: 'idle'
  }
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const roundToFive = (value: number): number => Math.max(5, Math.round(value / 5) * 5);

const openerBlocks: SessionBlock[] = [
  { type: 'work', minutes: 5 },
  { type: 'break', minutes: 5 },
  { type: 'work', minutes: 15 },
  { type: 'break', minutes: 5 },
  { type: 'work', minutes: 40 },
  { type: 'break', minutes: 10 }
];

export function generateAdaptiveSession(totalMinutes: number, rewardRatio = 0.2): SessionPlan {
  const blocks: SessionBlock[] = [];
  let remainingWork = Math.max(0, totalMinutes);
  let workCompleted = 0;
  let previousWork = 5;

  for (const block of openerBlocks) {
    if (block.type === 'work') {
      if (remainingWork <= 0) break;
      const minutes = Math.min(block.minutes, remainingWork);
      blocks.push({ type: 'work', minutes });
      remainingWork -= minutes;
      workCompleted += minutes;
      previousWork = minutes;
      continue;
    }

    if (workCompleted > 0 && remainingWork > 0) {
      blocks.push(block);
    }
  }

  while (remainingWork > 0) {
    const progress = workCompleted / Math.max(totalMinutes, 1);
    const growthFactor = 1.35 - progress * 0.35;
    const fatigueFactor = 1 - progress * 0.45;
    const rawNext = previousWork * growthFactor * fatigueFactor;
    const ceiling = Math.max(10, remainingWork * (1 - progress * 0.4));
    const nextWork = roundToFive(clamp(rawNext, 5, ceiling));
    const actualWork = Math.min(nextWork, remainingWork);

    blocks.push({ type: 'work', minutes: actualWork });
    workCompleted += actualWork;
    remainingWork -= actualWork;
    previousWork = actualWork;

    if (remainingWork <= 0) break;

    const nextBreak = roundToFive(clamp(actualWork * 0.25, 5, 15));
    blocks.push({ type: 'break', minutes: nextBreak });
  }

  return {
    blocks,
    rewardMinutes: Math.max(5, Math.round(workCompleted * rewardRatio)),
    totalWorkMinutes: workCompleted
  };
}

export function sortTasksForDay(tasks: Task[], day: string): Task[] {
  return [...tasks]
    .filter((task) => task.plannedDate === day)
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'done' ? 1 : -1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      const leftDue = Math.abs(Date.parse(left.dueDate) - Date.parse(day));
      const rightDue = Math.abs(Date.parse(right.dueDate) - Date.parse(day));
      return leftDue - rightDue;
    });
}

export function getDayOverview(tasks: Task[], rewardRatio = 0.2): DayOverview {
  const totalEstimatedMinutes = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const rewardMinutes = Math.max(0, Math.round(totalEstimatedMinutes * rewardRatio));
  const urgencyScore = tasks.reduce((sum, task) => sum + (10 - Math.min(9, task.priority)), 0);

  return {
    taskCount: tasks.length,
    totalEstimatedMinutes,
    rewardMinutes,
    urgencyScore
  };
}
