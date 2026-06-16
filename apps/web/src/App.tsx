import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultPlannerState, generateAdaptiveSession, getDayOverview, sortTasksForDay, type PlannerState, type SessionBlock, type Task } from '@task-scheduler/core';
import { downloadPlannerState, loadPlannerState, readPlannerStateFile, savePlannerState } from '@task-scheduler/storage';
import { Badge, Button, Card, Field, Pill } from '@task-scheduler/ui';

const todayKey = () => new Date().toISOString().slice(0, 10);

type AppView = 'planner' | 'timer' | 'storage';

type TaskFormState = {
  title: string;
  description: string;
  estimatedMinutes: number;
  dueDate: string;
  priority: number;
  plannedDate: string;
};

const blankTask = (plannedDate = todayKey()): TaskFormState => ({
  title: '',
  description: '',
  estimatedMinutes: 120,
  dueDate: todayKey(),
  priority: 2,
  plannedDate
});

const formatMinutes = (totalMinutes: number) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

const formatClock = (totalSeconds: number) => {
  const boundedSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(boundedSeconds / 60);
  const seconds = boundedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const createSessionKey = (taskId: string, blockIndex: number, eventType: string) => `${taskId}:${blockIndex}:${eventType}`;

const getCurrentBlockIndex = (task: Task, blocks: SessionBlock[]) => {
  let completedWork = task.completedMinutes;
  let progressWork = 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (block.type === 'work') {
      if (progressWork >= completedWork) {
        return index;
      }

      progressWork += block.minutes;

      if (progressWork >= completedWork) {
        return index + 1;
      }
    } else if (progressWork >= completedWork) {
      return index;
    }
  }

  return Math.max(0, blocks.length - 1);
};

const getBlockTitle = (block: SessionBlock | undefined) => {
  if (!block) return 'Ready to start';
  return block.type === 'work' ? 'Work block' : 'Break block';
};

const findTask = (tasks: Task[], taskId: string | null) => tasks.find((task) => task.id === taskId) ?? null;

const buildTimerFallback = () => ({
  taskId: null as string | null,
  blockIndex: 0,
  remainingSeconds: 0,
  status: 'idle' as const
});

const timerCircumference = 2 * Math.PI * 84;

export function App() {
  const [state, setState] = useState<PlannerState>(() => loadPlannerState() ?? defaultPlannerState());
  const [view, setView] = useState<AppView>('planner');
  const [form, setForm] = useState<TaskFormState>(() => blankTask(state.activeDate));
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [timerTaskId, setTimerTaskId] = useState<string | null>(state.activeTaskId);
  const [status, setStatus] = useState('Ready');
  const audioRef = useRef<AudioContext | null>(null);
  const lastTimerCueRef = useRef('');

  useEffect(() => {
    savePlannerState(state);
  }, [state]);

  useEffect(() => {
    if (state.activeTaskId && !state.tasks.some((task) => task.id === state.activeTaskId)) {
      setState((current) => ({
        ...current,
        activeTaskId: null,
        timer: buildTimerFallback()
      }));
    }
  }, [state.activeTaskId, state.tasks]);

  useEffect(() => {
    if (!timerTaskId && state.tasks.length > 0) {
      setTimerTaskId(state.tasks[0].id);
    }
  }, [state.tasks, timerTaskId]);

  useEffect(() => {
    if (state.timer.status !== 'running' || state.timer.remainingSeconds > 0 || !state.timer.taskId) {
      return;
    }

    setState((current) => {
      const task = findTask(current.tasks, current.timer.taskId);

      if (!task) {
        return {
          ...current,
          activeTaskId: null,
          timer: buildTimerFallback()
        };
      }

      const blocks = generateAdaptiveSession(task.estimatedMinutes, current.rewardRatio).blocks;
      const currentBlock = blocks[current.timer.blockIndex];

      if (!currentBlock) {
        return {
          ...current,
          activeTaskId: null,
          timer: buildTimerFallback()
        };
      }

      const nextCompletedMinutes = currentBlock.type === 'work'
        ? Math.min(task.estimatedMinutes, task.completedMinutes + currentBlock.minutes)
        : task.completedMinutes;
      const nextBlockIndex = current.timer.blockIndex + 1;
      const nextBlock = blocks[nextBlockIndex];

      if (currentBlock.type === 'work' && nextCompletedMinutes >= task.estimatedMinutes) {
        return {
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, completedMinutes: nextCompletedMinutes, status: 'done' } : item)),
          activeTaskId: null,
          timer: buildTimerFallback()
        };
      }

      if (!nextBlock) {
        return {
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, completedMinutes: nextCompletedMinutes, status: nextCompletedMinutes >= item.estimatedMinutes ? 'done' : item.status } : item)),
          activeTaskId: null,
          timer: buildTimerFallback()
        };
      }

      return {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, completedMinutes: nextCompletedMinutes, status: nextCompletedMinutes >= item.estimatedMinutes ? 'done' : 'active' } : item)),
        activeTaskId: task.id,
        timer: {
          taskId: task.id,
          blockIndex: nextBlockIndex,
          remainingSeconds: nextBlock.minutes * 60,
          status: 'running'
        }
      };
    });

    const cueKey = createSessionKey(state.timer.taskId, state.timer.blockIndex, 'advance');
    if (lastTimerCueRef.current !== cueKey) {
      lastTimerCueRef.current = cueKey;
      void playCue('advance');
      void notifyTimer('Time to switch blocks', 'The current block is complete.');
    }
  }, [state.timer.blockIndex, state.timer.remainingSeconds, state.timer.status, state.timer.taskId]);

  useEffect(() => {
    if (state.timer.status !== 'running' || !state.timer.taskId || state.timer.remainingSeconds <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setState((current) => {
        if (current.timer.status !== 'running' || current.timer.remainingSeconds <= 0) {
          return current;
        }

        return {
          ...current,
          timer: {
            ...current.timer,
            remainingSeconds: current.timer.remainingSeconds - 1
          }
        };
      });
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [state.timer]);

  const tasksForDay = useMemo(() => sortTasksForDay(state.tasks, selectedDate), [selectedDate, state.tasks]);
  const overview = useMemo(() => getDayOverview(tasksForDay, state.rewardRatio), [state.rewardRatio, tasksForDay]);
  const activeTask = useMemo(() => findTask(state.tasks, state.activeTaskId), [state.activeTaskId, state.tasks]);
  const selectedTimerTask = useMemo(() => findTask(state.tasks, timerTaskId ?? state.activeTaskId), [state.activeTaskId, state.tasks, timerTaskId]);
  const timerStateForSelectedTask = selectedTimerTask && state.timer.taskId === selectedTimerTask.id ? state.timer : null;
  const selectedTimerBlocks = useMemo(() => {
    if (!selectedTimerTask) return [];

    return generateAdaptiveSession(selectedTimerTask.estimatedMinutes, state.rewardRatio).blocks;
  }, [selectedTimerTask, state.rewardRatio]);
  const currentBlockIndex = timerStateForSelectedTask ? timerStateForSelectedTask.blockIndex : selectedTimerTask ? getCurrentBlockIndex(selectedTimerTask, selectedTimerBlocks) : 0;
  const currentBlock = selectedTimerBlocks[currentBlockIndex];
  const completedBlocks = currentBlockIndex;
  const totalBlocks = Math.max(selectedTimerBlocks.length, 1);
  const remainingSeconds = timerStateForSelectedTask ? timerStateForSelectedTask.remainingSeconds : currentBlock ? currentBlock.minutes * 60 : 0;
  const blockProgress = currentBlock ? 1 - (remainingSeconds / Math.max(currentBlock.minutes * 60, 1)) : 0;
  const overallProgress = Math.min(1, Math.max(0, (completedBlocks + blockProgress) / totalBlocks));

  const resetForm = (nextDate = selectedDate) => {
    setForm(blankTask(nextDate));
    setEditingTaskId(null);
  };

  const addTask = () => {
    if (!form.title.trim()) {
      setStatus('Add a title first.');
      return;
    }

    const nextTask: Task = {
      id: crypto.randomUUID(),
      title: form.title.trim(),
      description: form.description.trim(),
      estimatedMinutes: Math.max(5, Math.round(form.estimatedMinutes || 5)),
      dueDate: form.dueDate,
      priority: Math.min(5, Math.max(1, Math.round(form.priority || 1))),
      plannedDate: form.plannedDate,
      completedMinutes: 0,
      status: 'planned',
      createdAt: new Date().toISOString()
    };

    setState((current) => ({ ...current, tasks: [nextTask, ...current.tasks] }));
    resetForm(form.plannedDate);
    setStatus('Task added.');
  };

  const saveTask = () => {
    if (!editingTaskId) return addTask();

    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (
        task.id === editingTaskId
          ? {
              ...task,
              title: form.title.trim(),
              description: form.description.trim(),
              estimatedMinutes: Math.max(5, Math.round(form.estimatedMinutes || 5)),
              dueDate: form.dueDate,
              priority: Math.min(5, Math.max(1, Math.round(form.priority || 1))),
              plannedDate: form.plannedDate
            }
          : task
      ))
    }));
    resetForm(form.plannedDate);
    setStatus('Task updated.');
  };

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, ...updates } : task))
    }));
  };

  const startTimerForTask = async (taskId: string) => {
    const task = findTask(state.tasks, taskId);
    if (!task) return;

    if (task.status === 'done') {
      setStatus('This task is already complete.');
      return;
    }

    const existingTimer = state.timer.taskId === taskId ? state.timer : null;

    if (existingTimer?.status === 'running') {
      setState((current) => ({
        ...current,
        timer: {
          ...current.timer,
          status: 'paused'
        }
      }));
      setStatus('Timer paused.');
      return;
    }

    if (existingTimer?.status === 'paused' && existingTimer.remainingSeconds > 0) {
      setState((current) => ({
        ...current,
        activeTaskId: taskId,
        timer: {
          ...current.timer,
          status: 'running'
        }
      }));
      setStatus('Timer resumed.');
      void playCue('resume');
      return;
    }

    const blocks = generateAdaptiveSession(task.estimatedMinutes, state.rewardRatio).blocks;
    const startIndex = state.timer.taskId === taskId && state.timer.remainingSeconds > 0 && state.timer.status !== 'idle'
      ? state.timer.blockIndex
      : getCurrentBlockIndex(task, blocks);
    const startBlock = blocks[startIndex] ?? blocks[0];

    if (!startBlock) {
      setStatus('No block plan is available for this task.');
      return;
    }

    setState((current) => ({
      ...current,
      activeTaskId: taskId,
      timer: {
        taskId,
        blockIndex: startIndex,
        remainingSeconds: Math.max(1, startBlock.minutes * 60),
        status: 'running'
      },
      tasks: current.tasks.map((item) => (item.id === taskId ? { ...item, status: 'active' } : item))
    }));
    setTimerTaskId(taskId);
    setView('timer');
    setStatus(`Starting ${task.title}.`);
    lastTimerCueRef.current = createSessionKey(taskId, startIndex, 'start');
    void playCue('start');
    const permission = await requestAlerts();
    if (permission === 'granted') {
      void notifyTimer('Start working', task.title);
    }
  };

  const stopTimer = () => {
    setState((current) => ({
      ...current,
      activeTaskId: null,
      timer: buildTimerFallback()
    }));
    setStatus('Timer cleared.');
  };

  const editTask = (task: Task) => {
    setEditingTaskId(task.id);
    setForm({
      title: task.title,
      description: task.description,
      estimatedMinutes: task.estimatedMinutes,
      dueDate: task.dueDate,
      priority: task.priority,
      plannedDate: task.plannedDate
    });
    setView('planner');
    setStatus(`Editing ${task.title}.`);
  };

  const jumpToBlock = async (blockIndex: number) => {
    if (!selectedTimerTask) return;

    const block = selectedTimerBlocks[blockIndex];
    if (!block) return;

    setState((current) => ({
      ...current,
      activeTaskId: selectedTimerTask.id,
      timer: {
        taskId: selectedTimerTask.id,
        blockIndex,
        remainingSeconds: Math.max(1, block.minutes * 60),
        status: 'running'
      },
      tasks: current.tasks.map((task) => (task.id === selectedTimerTask.id ? { ...task, status: 'active' } : task))
    }));
    setTimerTaskId(selectedTimerTask.id);
    setView('timer');
    setStatus(`Jumped to ${block.type} block ${blockIndex + 1}.`);
    lastTimerCueRef.current = createSessionKey(selectedTimerTask.id, blockIndex, 'jump');
    void playCue('start');
    const permission = await requestAlerts();
    if (permission === 'granted') {
      void notifyTimer('Start working', selectedTimerTask.title);
    }
  };

  const removeTask = (taskId: string) => {
    setState((current) => {
      const nextTasks = current.tasks.filter((task) => task.id !== taskId);
      const isActiveTask = current.activeTaskId === taskId;

      return {
        ...current,
        tasks: nextTasks,
        activeTaskId: isActiveTask ? null : current.activeTaskId,
        timer: isActiveTask ? buildTimerFallback() : current.timer
      };
    });
    if (editingTaskId === taskId) {
      resetForm();
    }
    setStatus('Task removed.');
  };

  const onImportFile = async (file: File) => {
    const imported = await readPlannerStateFile(file);
    setState(imported);
    setSelectedDate(imported.activeDate ?? todayKey());
    setTimerTaskId(imported.activeTaskId);
    setEditingTaskId(null);
    setForm(blankTask(imported.activeDate));
    setStatus('Loaded planner JSON.');
  };

  const requestAlerts = async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!('Notification' in window)) {
      setStatus('Notifications are not supported in this browser.');
      return 'unsupported';
    }

    if (Notification.permission === 'granted') {
      setStatus('Notifications are enabled.');
      return 'granted';
    }

    const permission = await Notification.requestPermission();
    setStatus(permission === 'granted' ? 'Notifications enabled.' : 'Notifications blocked.');
    return permission;
  };

  const notifyTimer = async (title: string, body: string) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    new Notification(title, { body });
  };

  const playCue = async (mode: 'start' | 'advance' | 'resume') => {
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;

      if (context.state === 'suspended') {
        await context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const frequencies = mode === 'advance' ? [660, 880] : mode === 'resume' ? [540] : [720, 960];

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequencies[0], now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch {
      setStatus('Audio cue could not be played.');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar card">
        <div>
          <Pill>Task Flow</Pill>
          <h1>Focus Ledger</h1>
          <p className="sidebar-copy">A local-first planner with adaptive blocks, a current-task timer, and JSON storage.</p>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-button ${view === 'planner' ? 'is-active' : ''}`} onClick={() => setView('planner')}>Planner</button>
          <button className={`nav-button ${view === 'timer' ? 'is-active' : ''}`} onClick={() => setView('timer')}>Timer</button>
          <button className={`nav-button ${view === 'storage' ? 'is-active' : ''}`} onClick={() => setView('storage')}>Storage</button>
        </nav>

        <div className="sidebar-footer">
          <Badge>{status}</Badge>
          <Button variant="ghost" onClick={requestAlerts}>Enable alerts</Button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar card">
          <div>
            <span className="eyebrow">Local-first study planner</span>
            <h2>{view === 'planner' ? 'Planner' : view === 'timer' ? 'Current task' : 'Storage'}</h2>
          </div>

          <div className="topbar-actions">
            <Card tone="soft"><span className="stat-label">Today</span><strong>{todayKey()}</strong></Card>
            <Card tone="soft"><span className="stat-label">Tasks</span><strong>{overview.taskCount}</strong></Card>
            <Card tone="soft"><span className="stat-label">Reward</span><strong>{formatMinutes(overview.rewardMinutes)}</strong></Card>
          </div>
        </header>

        {view === 'planner' ? (
          <section className="content-grid">
            <Card className="panel">
              <div className="panel-head">
                <div>
                  <h2>{editingTaskId ? 'Edit task' : 'Create task'}</h2>
                  <p>Tasks stay editable after creation, even when the description is blank.</p>
                </div>
                <Field label="Target day" type="date" value={form.plannedDate} onChange={(value) => setForm((current) => ({ ...current, plannedDate: value }))} compact />
              </div>

              <div className="form-grid">
                <Field label="Title" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} placeholder="Read chapter 4" />
                <Field label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} placeholder="Optional details" />
                <Field label="Estimated minutes" type="number" value={String(form.estimatedMinutes)} onChange={(value) => setForm((current) => ({ ...current, estimatedMinutes: Number(value) || 0 }))} />
                <Field label="Priority" type="number" value={String(form.priority)} onChange={(value) => setForm((current) => ({ ...current, priority: Number(value) || 1 }))} />
                <Field label="Due date" type="date" value={form.dueDate} onChange={(value) => setForm((current) => ({ ...current, dueDate: value }))} />
              </div>

              <div className="actions-row wrap">
                <Button onClick={() => void saveTask()}>{editingTaskId ? 'Save changes' : 'Add task'}</Button>
                <Button variant="ghost" onClick={() => resetForm(form.plannedDate)}>Reset</Button>
                {editingTaskId ? <Button variant="ghost" onClick={() => resetForm(form.plannedDate)}>Cancel edit</Button> : null}
              </div>
            </Card>

            <Card className="panel">
              <div className="panel-head">
                <div>
                  <h2>Day view</h2>
                  <p>Solid, readable cards with direct controls for each task.</p>
                </div>
                <Field label="Date" type="date" value={selectedDate} onChange={setSelectedDate} compact />
              </div>

              <div className="day-summary">
                <Card tone="soft"><span className="stat-label">Queued</span><strong>{overview.taskCount}</strong></Card>
                <Card tone="soft"><span className="stat-label">Planned work</span><strong>{formatMinutes(overview.totalEstimatedMinutes)}</strong></Card>
                <Card tone="soft"><span className="stat-label">Urgency</span><strong>{overview.urgencyScore}</strong></Card>
              </div>

              <div className="task-list">
                {tasksForDay.length === 0 ? <p className="empty-state">No tasks planned for this day yet.</p> : null}
                {tasksForDay.map((task) => {
                  const session = generateAdaptiveSession(task.estimatedMinutes, state.rewardRatio);
                  const progress = task.estimatedMinutes === 0 ? 0 : Math.round((task.completedMinutes / task.estimatedMinutes) * 100);

                  return (
                    <article className={`task-card ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
                      <div className="task-card-top">
                        <div>
                          <h3>{task.title}</h3>
                          <p>{task.description || 'No description provided.'}</p>
                        </div>
                        <Badge>Priority {task.priority}</Badge>
                      </div>

                      <div className="task-meta">
                        <span>{formatMinutes(task.estimatedMinutes)}</span>
                        <span>Due {task.dueDate}</span>
                        <span>{progress}% done</span>
                      </div>

                      <div className="session-strip">
                        {session.blocks.slice(0, 6).map((block, index) => (
                          <span key={`${task.id}-${index}`} className={`block ${block.type}`}>{block.minutes}m</span>
                        ))}
                      </div>

                      <div className="actions-row wrap">
                        <Button variant="ghost" onClick={() => void startTimerForTask(task.id)}>Start task</Button>
                        <Button variant="ghost" onClick={() => editTask(task)}>Edit</Button>
                        <Button variant="ghost" onClick={() => updateTask(task.id, { priority: Math.min(5, task.priority + 1) })}>Raise priority</Button>
                        <Button variant="ghost" onClick={() => updateTask(task.id, { priority: Math.max(1, task.priority - 1) })}>Lower priority</Button>
                        <Button variant="ghost" onClick={() => removeTask(task.id)}>Delete</Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </Card>
          </section>
        ) : null}

        {view === 'timer' ? (
          <section className="timer-layout">
            <Card className="panel timer-panel">
              <div className="panel-head">
                <div>
                  <h2>Current task</h2>
                  <p>Start a task, pause it, and watch the block ring advance as work and breaks complete.</p>
                </div>
                <div className="timer-picker">
                  <label>
                    <span>Choose task</span>
                    <select value={timerTaskId ?? ''} onChange={(event) => setTimerTaskId(event.target.value)}>
                      <option value="">Select a task</option>
                      {state.tasks.map((task) => (
                        <option key={task.id} value={task.id}>{task.title}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {selectedTimerTask ? (
                <div className="timer-stage">
                  <div className="timer-ring">
                    <span className="timer-kicker timer-kicker-top">{getBlockTitle(currentBlock)}</span>
                    <div className="timer-ring-canvas">
                    <svg viewBox="0 0 220 220" className="timer-svg" aria-hidden="true">
                      <circle className="timer-track" cx="110" cy="110" r="84" />
                      <circle
                        className="timer-progress"
                        cx="110"
                        cy="110"
                        r="84"
                        style={{ strokeDasharray: timerCircumference, strokeDashoffset: `${Math.max(0, timerCircumference - timerCircumference * overallProgress)}` }}
                      />
                    </svg>

                    <div className="timer-overlay">
                      <strong>{currentBlock ? currentBlock.minutes : 0}m</strong>
                      <div className="timer-time">{timerStateForSelectedTask ? formatClock(remainingSeconds) : formatMinutes(selectedTimerTask.estimatedMinutes - selectedTimerTask.completedMinutes)}</div>
                    </div>
                    </div>
                    <p className="timer-block-count">{currentBlockIndex + 1} of {totalBlocks} blocks</p>
                  </div>

                  <div className="timer-copy">
                    <h3>{selectedTimerTask.title}</h3>
                    <p>{selectedTimerTask.description || 'No description provided.'}</p>
                    <div className="timer-meta">
                      <span>Due {selectedTimerTask.dueDate}</span>
                      <span>Progress {Math.round(overallProgress * 100)}%</span>
                      <span>{selectedTimerTask.status}</span>
                    </div>

                    <div className="actions-row wrap">
                      <Button onClick={() => void startTimerForTask(selectedTimerTask.id)}>{state.timer.taskId === selectedTimerTask.id && state.timer.status === 'running' ? 'Pause' : state.timer.taskId === selectedTimerTask.id && state.timer.status === 'paused' ? 'Resume' : 'Start task'}</Button>
                      <Button variant="ghost" onClick={stopTimer}>Clear timer</Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">Choose a task, then start it from Planner or here.</div>
              )}
            </Card>

            <Card className="panel">
              <div className="panel-head">
                <div>
                  <h2>Block list</h2>
                  <p>Each block is shown as a clean solid pill so the sequence is easy to scan.</p>
                </div>
              </div>

              <div className="task-list">
                {selectedTimerBlocks.map((block, index) => (
                  <button key={`${block.type}-${index}`} type="button" className={`block-row ${index === currentBlockIndex ? 'is-active' : ''}`} onClick={() => void jumpToBlock(index)}>
                    <span className={`block-chip ${block.type}`}>{block.type === 'work' ? 'Work' : 'Break'}</span>
                    <strong>{block.minutes} minutes</strong>
                    <span>{index < currentBlockIndex ? 'Completed' : index === currentBlockIndex ? 'Current' : 'Upcoming'}</span>
                  </button>
                ))}
              </div>
            </Card>
          </section>
        ) : null}

        {view === 'storage' ? (
          <section className="content-grid storage-grid">
            <Card className="panel">
              <div className="panel-head">
                <div>
                  <h2>Storage</h2>
                  <p>Auto-saves locally and can export or import JSON.</p>
                </div>
              </div>

              <div className="actions-row wrap">
                <Button onClick={() => downloadPlannerState(state)}>Export JSON</Button>
                <label className="file-button">
                  Import JSON
                  <input type="file" accept="application/json" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      await onImportFile(file);
                    }
                    event.target.value = '';
                  }} />
                </label>
              </div>

              <div className="notes">
                <p>State is stored locally in the browser and can also be exported as a JSON file.</p>
                <p>The scheduling core stays separate from the UI so desktop or mobile packaging can reuse it later.</p>
              </div>
            </Card>

            <Card className="panel">
              <div className="panel-head">
                <div>
                  <h2>Status</h2>
                  <p>Timer alerts, audio cues, and current task state are now active.</p>
                </div>
              </div>

              <div className="summary-list">
                <div><span>Notifications</span><strong>{'Notification' in window ? Notification.permission : 'unsupported'}</strong></div>
                <div><span>Active task</span><strong>{activeTask?.title ?? 'None'}</strong></div>
                <div><span>Timer mode</span><strong>{state.timer.status}</strong></div>
              </div>
            </Card>
          </section>
        ) : null}
      </main>
    </div>
  );
}
