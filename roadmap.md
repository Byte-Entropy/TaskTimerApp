# Roadmap: Lightweight Task Scheduler MVP

## TL;DR

A web-first, local-first task planner for study sessions that minimizes startup friction, adapts work into small early segments, and automatically turns completed work into relax time.

- Task creation: add a task with title, description, estimated work, due date, and priority.
- Day planning: place tasks into a day view and reorder by priority.
- Adaptive session slotting: split a task into short-to-long work blocks that start small, ramp up, then taper down.
- Break rewards: compute relaxation breaks automatically from the amount of work completed.
- Portable storage: save the full state to JSON first, with CSV export optional later.
- Future portability: keep the core logic framework-neutral so it can later be packaged for desktop and mobile.

## Detailed Goals

### 1. Task entry and planning

The app should let you create a task with a description, an estimated total work time $T$, a priority value, and a target day. The goal is to make entering real study tasks fast enough that the app does not become another chore.

### 2. Day view and prioritization

The app should show the tasks planned for a given day in a calendar-like or timeline-like view. Tasks should be sortable by priority and by how urgently they need attention. The first version should favor clarity over visual complexity.

### 3. Adaptive session segmentation

For each task, the app should generate a sequence of work and break blocks that lowers the psychological cost of starting. A good default is:

- first block: $5$ minutes work
- then: $5$ minutes break
- next: $15$ minutes work
- then: $5$ minutes break
- next: $40$ minutes work
- then: $10$ minutes break

After the opener, later blocks should adapt so the session still feels manageable. If the task has remaining work $R$, the next block should follow a bounded growth rule rather than jumping too quickly. A simple default is:

$w_{n+1} = \min(w_{n} \cdot g,\; w_{\max}(R, E))$

where $w_n$ is the current work block, $g$ is a growth factor greater than $1$, $R$ is remaining work, and $E$ is elapsed focused time. A practical efficiency-first choice is $g = 1.5$ to $2.0$, with a ceiling that shrinks as $E$ increases.

To reduce burnout near the end of a long session, taper later blocks using a fatigue factor:

$w_{effective} = w_{base} \cdot \left(1 - \alpha \cdot \frac{E}{T}\right)$

where $\alpha$ controls how aggressively the app backs off as the user approaches the full task duration.

The key behavior is: start with the easiest possible commitment, then only increase work size if the user is already engaged.

### 4. Automatic relax-time rewards

Relax time should be derived from completed work so the app feels like a reward system, not a second scheduler. A simple default is to map each completed work minute to a smaller amount of break time:

$b = \beta \cdot w$

where $b$ is break time, $w$ is completed work, and $\beta$ is a constant such as $0.15$ to $0.25$ for a light reward feel.

For example, $60$ minutes of completed work could generate roughly $9$ to $15$ minutes of relax time depending on the chosen ratio. This keeps the reward meaningful without making the app encourage avoidance.

### 5. JSON persistence

The prototype should save all tasks, their schedules, and completion state to a JSON file. JSON is the right default because it handles nested data such as task segments and reward history more naturally than CSV.

CSV can remain a future export option, but it should not be the primary storage format.

### 6. Portable architecture

The implementation should avoid locking the app to one OS. The core scheduling and storage logic should stay separate from the UI so the same code can later be packaged for Windows or mobile.

A web-first build is the fastest path for the prototype and gives the best chance of reuse later for desktop packaging or a mobile wrapper.

### 7. MVP boundaries

The first version should not try to solve full project management, team collaboration, cloud sync, or complex analytics. The goal is a reliable personal planning tool that can help with an exam in the next few days.

The app only needs enough intelligence to reduce startup friction, keep the session moving, and make progress visible.
