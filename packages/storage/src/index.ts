import type { PlannerState } from '../../core/src/index';
import { defaultPlannerState } from '../../core/src/index';

const storageKey = 'task-flow.state.v1';

export function loadPlannerState(): PlannerState | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    return normalizePlannerState(JSON.parse(raw) as Partial<PlannerState>);
  } catch {
    return null;
  }
}

export function savePlannerState(state: PlannerState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(state, null, 2));
}

export function downloadPlannerState(state: PlannerState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `task-flow-${state.activeDate}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function readPlannerStateFile(file: File): Promise<PlannerState> {
  const text = await file.text();
  return normalizePlannerState(JSON.parse(text) as Partial<PlannerState>);
}

function normalizePlannerState(state: Partial<PlannerState>): PlannerState {
  const defaults = defaultPlannerState();

  return {
    activeDate: typeof state.activeDate === 'string' ? state.activeDate : defaults.activeDate,
    tasks: Array.isArray(state.tasks) ? state.tasks : defaults.tasks,
    rewardRatio: typeof state.rewardRatio === 'number' ? state.rewardRatio : defaults.rewardRatio,
    activeTaskId: typeof state.activeTaskId === 'string' || state.activeTaskId === null ? state.activeTaskId ?? null : defaults.activeTaskId,
    timer: {
      taskId: state.timer && (typeof state.timer.taskId === 'string' || state.timer.taskId === null) ? state.timer.taskId ?? null : defaults.timer.taskId,
      blockIndex: state.timer && typeof state.timer.blockIndex === 'number' ? state.timer.blockIndex : defaults.timer.blockIndex,
      remainingSeconds: state.timer && typeof state.timer.remainingSeconds === 'number' ? state.timer.remainingSeconds : defaults.timer.remainingSeconds,
      status: state.timer && (state.timer.status === 'idle' || state.timer.status === 'running' || state.timer.status === 'paused')
        ? state.timer.status
        : defaults.timer.status
    }
  };
}
