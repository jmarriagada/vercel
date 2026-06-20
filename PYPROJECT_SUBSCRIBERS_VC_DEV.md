# `tool.vercel.subscribers` in `vercel dev`

## Purpose

This document describes how to wire Python `tool.vercel.subscribers` from
`pyproject.toml` into `vercel dev` so standalone Python framework projects can
test Vercel Queues locally.

The target local workflow is a project like FastAPI plus Celery:

```toml
[project]
name = "fastapi-celery"
dependencies = [
  "fastapi",
  "celery",
  "vercel",
]

[tool.vercel]
entrypoint = "main:app"

[tool.vercel.subscribers.celery-worker]
entrypoint = "worker:app"
topics = ["celery"]
retry_after_seconds = 10
max_deliveries = 3
```

Running `vercel dev` should:

1. Start the FastAPI app normally.
2. Start a hidden local worker callback server for `worker:app`.
3. Start the in-memory dev queue broker.
4. Configure Python queue publishers to use the local broker.
5. Deliver enqueued messages to the hidden worker through the same callback
   protocol used by deployed Vercel Queue triggers.

The intended result is that `process_job.delay(...)` in the FastAPI process
publishes to the local dev broker and the Celery callback worker executes the
task locally, without requiring `experimentalServices` in `vercel.json`.

## Implementer TL;DR

The delivery mechanism is already proven: the existing
`[vercel dev] web send() triggers exact and wildcard worker execution` test
exercises the same broker → `queue/v2beta` CloudEvent → Python worker (started
via `startDevServer`) path this feature reuses. The new work is discovery,
hidden-worker orchestration, and env wiring for the standalone (non-services)
case.

Key decisions (details below):

- Parse subscribers via a new `getDevQueueConsumers` method on the **resolved**
  Python builder, never a static `@vercel/python` import in the CLI bundle.
- Generalize `QueueBroker` to a source-agnostic `DevQueueConsumer[]`; add a
  services adapter so existing behavior is preserved.
- Start hidden workers through a single shared `startPythonWorkerViaBuilder()`
  helper, also used by `ServicesOrchestrator` (no duplicate startup path).
- Inject `VERCEL_HAS_WORKER_SERVICES` + local `VERCEL_QUEUE_*` so queue vars
  **win** over inherited/cloud env (`cloneEnv(runEnv, queueEnv)`), preventing
  accidental publishes to a real queue.
- Gate the `/_svc/_queues/*` route on `this.queueBroker` (not
  `this.orchestrator`).
- Lean on `@vercel/python`'s existing `PERSISTENT_SERVERS` exit reaper for
  cleanup; `controller.stopAll()` covers graceful teardown.

One assumption must be validated first (see Still Needs Validation): a
no-`vercel.json` Python framework project resolves to exactly one
`@vercel/python` framework build match in dev with `config.framework` set, and
the web app is served via the lazy per-request `startDevServer` path.

## Current Behavior

### Build-time subscriber support

Python subscriber support already exists for deployment builds.

Relevant files:

- `packages/python/src/subscribers.ts`
- `packages/python/src/index.ts`
- `python/vercel-workers/src/vercel/workers/*`
- `python/vercel-runtime/src/vercel_runtime/*`

`packages/python/src/subscribers.ts` parses:

```toml
[tool.vercel.subscribers.<name>]
entrypoint = "module:object"
topics = ["topic"]
max_deliveries = 3
retry_after_seconds = 10
initial_delay_seconds = 0
max_concurrency = 5
```

It validates:

- Subscriber name starts with a letter, ends with an alphanumeric character,
  and contains only alphanumeric characters, hyphens, and underscores.
- `entrypoint` is a string in `module:object` form.
- The referenced Python file exists.
- `topics` is a non-empty string array.
- Numeric trigger fields have valid ranges.
- Unknown fields fail fast.

`packages/python/src/index.ts` uses these subscribers only when:

- The build is for a Python framework project.
- The build is not for an `experimentalServices` service.
- The build is not for bare `api/**` per-file functions.

For each subscriber it emits an additional Lambda at:

```text
_py_subscribers/<safeSubscriberName>
```

Each emitted subscriber Lambda gets queue triggers:

```ts
{
  type: 'queue/v2beta',
  topic,
  consumer: sanitizeConsumerName('_py_subscribers/<safeSubscriberName>'),
  ...subscriber.triggerDefaults,
}
```

The web Lambda gets `VERCEL_HAS_WORKER_SERVICES=1` when subscribers exist so
`vercel-workers` is installed and queue integrations are activated.

### Python runtime support

The Python runtime and worker packages already know how to bootstrap queue
callback workers.

`packages/python/src/start-dev-server.ts` installs `vercel-workers` during
`vercel dev` when `VERCEL_HAS_WORKER_SERVICES` is truthy.

`python/vercel-runtime/src/vercel_runtime/dev.py` calls
`prepare_worker_environment()` before importing the user module. That bridge
delegates to `vercel.workers._runtime.prepare_environment()`, which:

- Defaults `CELERY_BROKER_URL` to `vercel://` when
  `VERCEL_HAS_WORKER_SERVICES=1` and no broker URL is already set.
- Installs the Kombu transport alias for Celery's `vercel://` broker.

When `VERCEL_SERVICE_TYPE=worker`, `vercel_runtime.dev` calls
`maybe_bootstrap_worker_service_app()`. The `vercel-workers` runtime can
bootstrap a queue callback ASGI app from:

- Celery apps
- Dramatiq brokers
- Django tasks
- Generic `@subscribe` handlers

This means the Python side already has the required local callback runtime as
long as `vercel dev` starts the subscriber entrypoints as worker processes and
sets the right environment variables.

### Existing `experimentalServices` dev queue path

`packages/cli/src/util/dev/server.ts` creates a `QueueBroker` only when
`experimentalServices` contains queue-backed services.

Relevant files:

- `packages/cli/src/util/dev/server.ts`
- `packages/cli/src/util/dev/queue-broker.ts`
- `packages/cli/src/util/dev/services-orchestrator.ts`

In services mode:

1. `ServicesOrchestrator` starts all services.
2. It injects queue env into service processes when any queue-backed service
   exists:
   - `VERCEL_HAS_WORKER_SERVICES=1` for Python services
   - `VERCEL_QUEUE_BASE_URL=<dev-origin>/_svc/_queues`
   - `VERCEL_QUEUE_TOKEN=vc-dev-token`
3. `DevServer` creates `QueueBroker`.
4. `QueueBroker` registers one consumer group per queue-backed service topic.
5. Queue sends hit:
   `/_svc/_queues/api/v3/topic/<topic>`.
6. The broker stores the message and dispatches a `queue/v2beta` CloudEvent to
   the matching worker service origin.
7. Worker callback code uses VQS receive, ack, and visibility endpoints exposed
   through the same `/_svc/_queues` proxy path.

This path is already close to what `tool.vercel.subscribers` needs.

## Gap

Standalone Python projects with `tool.vercel.subscribers` do not go through
`ServicesOrchestrator`, so none of the local queue machinery is activated.

Today, a standalone FastAPI plus Celery project has these gaps in `vercel dev`:

- `QueueBroker` is not initialized.
- `/_svc/_queues/*` routes are not handled because they are gated behind
  `this.orchestrator`.
- The web dev server does not receive `VERCEL_QUEUE_BASE_URL`.
- The web dev server does not receive `VERCEL_QUEUE_TOKEN`.
- The web dev server does not receive `VERCEL_HAS_WORKER_SERVICES=1` from
  subscriber discovery.
- No hidden subscriber worker processes are started.
- No local consumer groups are registered for pyproject subscribers.

## Goals

- Support local queue delivery for standalone Python framework projects using
  `tool.vercel.subscribers`.
- Reuse the existing in-memory dev `QueueBroker`.
- Reuse `@vercel/python` `startDevServer` for subscriber worker processes.
- Reuse the deployed queue callback protocol as much as possible.
- Keep `tool.vercel.subscribers` scoped to standalone Python framework
  projects, matching build-time behavior.
- Avoid requiring `experimentalServices` for simple FastAPI plus Celery local
  testing.
- Keep hidden subscriber workers out of the public "Available at" service list.
- Preserve the existing `experimentalServices` behavior.
- Add integration test coverage for the FastAPI plus Celery local workflow.

## Non-goals

- Do not make `tool.vercel.subscribers` work inside `experimentalServices`.
  Build-time code intentionally avoids this because services already have
  first-class workers and multiple services can share one `pyproject.toml`.
- Do not support bare `api/**` Python function projects in the first pass.
  Build-time code intentionally avoids generating subscribers for those because
  per-file builds would duplicate outputs.
- Do not implement a full production-equivalent queue service. The existing dev
  broker is an in-memory local approximation.
- Do not expose hidden subscribers as routable web services.
- Do not rely on `VERCEL_WORKERS_IN_PROCESS` for Celery. In-process mode only
  helps same-process generic subscriptions and does not match the deployed
  Celery callback worker model.

## Desired User Experience

Example project:

```text
.
├── main.py
├── worker.py
├── tasks.py
├── pyproject.toml
└── uv.lock
```

`pyproject.toml`:

```toml
[project]
name = "fastapi-celery"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi",
  "celery",
  "vercel",
]

[tool.vercel]
entrypoint = "main:app"

[tool.vercel.subscribers.celery-worker]
entrypoint = "worker:app"
topics = ["celery"]
```

`tasks.py`:

```py
from celery import Celery

app = Celery("fastapi-celery")
app.conf.task_default_queue = "celery"

@app.task(name="tasks.process_job")
def process_job(request_id: str) -> None:
    ...
```

`worker.py`:

```py
from tasks import app

__all__ = ["app"]
```

`main.py`:

```py
from fastapi import FastAPI
from tasks import process_job

app = FastAPI()

@app.post("/enqueue")
def enqueue():
    result = process_job.delay("abc")
    return {"taskId": result.id}
```

Expected local behavior:

```text
$ vercel dev
> Ready! Available at http://localhost:3000
```

Then:

```text
POST http://localhost:3000/enqueue
```

should enqueue through the local dev queue broker and invoke the hidden
`celery-worker` process.

## Proposed Architecture

Introduce a small local queue consumer abstraction that can represent both:

- Existing explicit `experimentalServices` queue-backed services.
- Hidden `tool.vercel.subscribers` worker processes.

This keeps the broker protocol independent from the source of the consumer.

### New dev consumer model

`DevQueueConsumerTopic` is shared (it crosses the CLI↔builder boundary, since
the Python builder returns it from `getDevQueueConsumers`), so define it in
`@vercel/build-utils`:

```ts
// @vercel/build-utils
export interface DevQueueConsumerTopic {
  topic: string;
  retryAfterSeconds?: number;
  initialDelaySeconds?: number;
  maxDeliveries?: number;
  maxConcurrency?: number;
}
```

`DevQueueConsumer` carries a runtime callback (`getOrigin`) and stays CLI-local
in `packages/cli/src/util/dev/queue-broker.ts`:

```ts
import type { DevQueueConsumerTopic } from '@vercel/build-utils';

export interface DevQueueConsumer {
  name: string;
  topics: DevQueueConsumerTopic[];
  getOrigin: () => string | null;
}
```

For `experimentalServices`, `name` remains the service name.

For pyproject subscribers, `name` is the same consumer name used in deployment,
produced by the builder:

```ts
sanitizeConsumerName(`_py_subscribers/${safePathSegment(subscriber.name)}`)
```

Callback metadata, receive, ack, and visibility requests all use the consumer
group name, so matching deployment naming keeps local metadata representative.
This is also route-safe: `sanitizeConsumerName` emits only `[A-Za-z0-9_-]`
(`_` → `__`, `/` → `_S`, `.` → `_D`, other → `_XX`), which satisfies the
broker's `([A-Za-z0-9_-]+)` consumer-path regexes, so the escaped name
round-trips through receive/ack/visibility routes unchanged.

### QueueBroker changes

Change `QueueBroker` from accepting only `ExperimentalService[]` to accepting
`DevQueueConsumer[]`.

Current constructor shape:

```ts
constructor(
  services: ExperimentalService[],
  private getServiceOrigin: (name: string) => string | null
) { ... }
```

Proposed constructor shape:

```ts
constructor(consumers: DevQueueConsumer[]) { ... }
```

The broker should register:

```ts
for (const consumer of consumers) {
  for (const topicConfig of consumer.topics) {
    const group = {
      id: `${consumer.name}::${topicConfig.topic}`,
      name: consumer.name,
      topicPattern: topicConfig.topic,
      topicRegex: topicPatternToRegex(topicConfig.topic),
      serviceOriginFn: consumer.getOrigin,
      retryAfterMs: ...
      maxDeliveries: ...
      initialDelayMs: ...
    };
  }
}
```

The broker already uses `group.name` as the consumer group for:

- CloudEvent headers.
- `receiveById()`.
- `receiveMessages()`.
- `acknowledge()`.
- `changeVisibility()`.
- receipt handle lookups.

No protocol change should be needed.

### `experimentalServices` adapter

Add a helper in CLI dev code:

```ts
export function getExperimentalServiceQueueConsumers(options: {
  services: Service[];
  getServiceOrigin: (name: string) => string | null;
}): DevQueueConsumer[] {
  return options.services
    .filter(isExperimentalService)
    .filter(isQueueBackedService)
    .map(service => ({
      name: service.name,
      topics: getServiceQueueTopicConfigs(service),
      getOrigin: () => options.getServiceOrigin(service.name),
    }));
}
```

This preserves existing behavior. `getServiceQueueTopicConfigs` returns
`ServiceQueueTopic[]` (`topic` + optional `retryAfterSeconds` /
`initialDelaySeconds`), which is assignable to `DevQueueConsumerTopic[]`; service
consumers simply keep the broker's default `maxDeliveries`.

### Pyproject subscriber adapter

Add a hidden subscriber orchestrator for standalone Python framework dev.

Suggested file:

```text
packages/cli/src/util/dev/pyproject-subscribers.ts
```

Responsibilities:

1. Detect whether the current dev project is eligible.
2. Get subscriber descriptors from the resolved builder via
   `getDevQueueConsumers({ workPath })`.
3. Start each descriptor as a hidden Python worker server through the shared
   `startPythonWorkerViaBuilder()` helper (see below).
4. Return `DevQueueConsumer[]` for the broker.
5. Provide `stopAll()` cleanup.

The controller must use the builder already resolved for the selected
`BuildMatch` (`pythonBuildMatch.builderWithPkg.builder`), never a separate
`@vercel/python` import. This keeps parsing, consumer naming, and worker startup
bound to one builder version.

Suggested public shape:

```ts
export interface PyprojectSubscriberDevController {
  consumers: DevQueueConsumer[];
  hasSubscribers: boolean;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}

export async function createPyprojectSubscriberDevController(options: {
  workPath: string; // DevServer.cwd (resolved project root)
  repoRoot: string;
  runEnv: NodeJS.ProcessEnv; // DevServer.envConfigs.runEnv (post queue-env injection)
  proxyOrigin: string; // DevServer.address.origin
  pythonBuildMatch: BuildMatch;
}): Promise<PyprojectSubscriberDevController | null>;
```

The controller should be created only for standalone mode, not when
`this.shouldUseServicesOrchestrator()` is true.

### Where subscriber parsing should live

Decision: parse through the **resolved builder instance**, not a static import
of `@vercel/python` internals.

Expose a new optional method on the Python builder and call it on the same
builder object the CLI already resolved for the web build match
(`pythonBuildMatch.builderWithPkg.builder`):

```ts
// packages/python/src/index.ts (new builder export)
export async function getDevQueueConsumers(options: {
  workPath: string;
}): Promise<PythonDevQueueConsumerDescriptor[]>;

export interface PythonDevQueueConsumerDescriptor {
  // Stable consumer-group name, already escaped for queue routing.
  consumer: string;
  // Resolved entrypoint file, relative to workPath (e.g. `worker.py`).
  entrypoint: string;
  // Entrypoint variable (e.g. `app`); passed as `handlerFunction`.
  variableName: string;
  topics: DevQueueConsumerTopic[];
}
```

Internally this wraps the existing `getPyprojectSubscribers()` and reuses
`safePathSegment()` / `sanitizeConsumerName()` so the dev consumer name is
**identical** to what `build` emits.

Why not a static `import { getPyprojectSubscribers } from '@vercel/python'`?

- `@vercel/python` is a `workspace:*` dependency of the CLI, so a static import
  compiles. But at runtime the CLI runs the worker via the builder it resolved
  through `importBuilders` (`match.builderWithPkg.builder`), which can be a
  project-pinned or downloaded version. A static import binds parsing to the
  CLI-bundled copy, so the parser and the runner can disagree on subscriber
  semantics (consumer naming, validation, output paths).
- Reaching into a builder's internal `./subscribers` module also breaks the
  CLI↔builder boundary that the rest of dev respects (builders are consumed only
  through `build`, `startDevServer`, `prepareCache`, `version`).

Routing through a builder method keeps a single source of truth (the resolved
builder) for both parsing and worker startup. The CLI defines
`DevQueueConsumerTopic` (see below) and `@vercel/python` imports the type from
`@vercel/build-utils` so both sides agree on the shape.

If adding a builder method is deferred, the only acceptable interim is to read
the descriptors from the resolved builder package path (the one
`importBuilders` returned), never from a hard-coded `@vercel/python` import in
the CLI bundle.

### Starting hidden subscriber workers

#### Avoiding duplication with the orchestrator

`ServicesOrchestrator.tryStartWithBuilder` already encapsulates the worker
startup recipe: resolve the builder, call `startDevServer` with a worker
`service` payload, wait for the port, track the PID, wire a logger, and capture
the `shutdown` callback. The subscriber controller needs the same recipe.

Extract that logic into a shared helper so there is exactly one Python worker
startup path:

```text
packages/cli/src/util/dev/start-python-worker.ts
```

```ts
export interface PythonWorkerHandle {
  origin: string; // http://127.0.0.1:<port>
  pid?: number;
  shutdown?: () => Promise<void>;
}

export async function startPythonWorkerViaBuilder(options: {
  builder: BuilderV3 | BuilderVX;
  entrypoint: string;
  workPath: string;
  repoRoot: string;
  framework: string; // web match framework, fallback 'python'
  handlerFunction: string; // descriptor.variableName
  consumerName: string; // descriptor.consumer -> service.name
  env: NodeJS.ProcessEnv;
  syncDependencies: boolean;
  serviceName: string; // unique persistent-server key suffix
  onStdout?: (b: Buffer) => void;
  onStderr?: (b: Buffer) => void;
}): Promise<PythonWorkerHandle>;
```

Refactor `tryStartWithBuilder` to call this helper too (or to share its core),
so services and pyproject subscribers cannot drift in startup or lifecycle.

#### Internal `startDevServer` call

The helper invokes the resolved builder's `startDevServer` exactly like explicit
worker services do:

```ts
const result = await options.builder.startDevServer!({
  files: {},
  entrypoint: options.entrypoint, // e.g. `worker.py`
  workPath: options.workPath, // the Python web match's workPath, NOT raw cwd
  repoRootPath: options.repoRoot,
  config: {
    framework: options.framework,
    handlerFunction: options.handlerFunction, // e.g. `app`
  },
  meta: {
    isDev: true,
    env: options.env,
    serviceCount: 0,
    pythonServiceCount: 1,
    syncDependencies: options.syncDependencies,
    serviceName: options.serviceName,
  },
  service: {
    name: options.consumerName,
    type: 'worker',
    trigger: 'queue',
  },
  onStdout: options.onStdout,
  onStderr: options.onStderr,
});
```

Important details:

- `entrypoint` is `descriptor.entrypoint` (the resolved file, e.g. `worker.py`).
- `workPath` is the dev server's resolved project root (`DevServer.cwd`, already
  normalized via `resolveProjectCwd`) — the same directory the Python web build
  match runs in during standalone dev. Pass this identical value to
  `getDevQueueConsumers` so parsing and worker startup agree on the work path.
  (Per-match work paths only diverge in services mode, which is excluded.)
- `handlerFunction` is `descriptor.variableName` (e.g. `app`). For
  `service.type='worker'`, `vercel_runtime.dev` bootstraps the worker callback
  app before normal framework app resolution, so the variable need not be an
  ASGI/WSGI app object.
- `config.framework` preserves the web match's framework when available, falling
  back to `'python'`. A non-empty framework is required for the Python dev
  server path.
- `service.name` is the consumer name. The broker addresses the worker by this
  name, so it must equal `descriptor.consumer`.
- `meta.serviceName` must be unique per subscriber so `startDevServer` does not
  collide with the web server's `PERSISTENT_SERVERS` key
  (`<workPath>::<framework>::<serviceName>`).
- `meta.serviceCount: 0` keeps the worker on the single-service venv path, which
  shares the project `.venv` with the lazily-started web server. In-process
  `PENDING_INSTALLS` guards concurrent injected-package installs because both
  `startDevServer` calls run on the same builder module instance.
- `serviceCount`/`pythonServiceCount`/`syncDependencies`/`serviceName` are
  informal `meta` fields read via casts in `start-dev-server.ts`; mirror the
  orchestrator's usage exactly so the contract stays consistent.

`syncDependencies` must run exactly once for the shared Python project before any
hidden worker imports user code. The web server is lazy and may not have started
yet, so the controller owns the sync: pass `syncDependencies: true` for the
first worker and `false` for the rest (guarded so multiple subscribers in one
work path do not each re-sync).

### Hidden worker env

Subscriber worker env should include:

```ts
{
  ...devRunEnv,
  FORCE_COLOR: process.stdout.isTTY ? '1' : '0',
  BROWSER: 'none',
  VERCEL_HAS_WORKER_SERVICES: '1',
  VERCEL_SERVICE_TYPE: 'worker',
  VERCEL_SERVICE_TRIGGER: 'queue',
  VERCEL_QUEUE_BASE_URL: `${proxyOrigin}/_svc/_queues`,
  VERCEL_QUEUE_TOKEN: 'vc-dev-token',
}
```

The web dev server env should include:

```ts
{
  VERCEL_HAS_WORKER_SERVICES: '1',
  VERCEL_QUEUE_BASE_URL: `${proxyOrigin}/_svc/_queues`,
  VERCEL_QUEUE_TOKEN: 'vc-dev-token',
}
```

This enables:

- `vercel-workers` injection by `@vercel/python`.
- Celery default `CELERY_BROKER_URL=vercel://`.
- Queue sends to the local broker.
- Queue receive, ack, and visibility calls to the local broker.

Precedence matters: `VERCEL_QUEUE_BASE_URL` and `VERCEL_QUEUE_TOKEN` must
**override** any inherited values (process env or pulled cloud env), otherwise
`vercel dev` could publish test messages to a real remote queue. In the object
literals above this is satisfied because the queue keys appear last and win. The
equivalent care is required in Step 5 where `cloneEnv` ordering decides the
winner.

Do not overwrite user-provided `CELERY_BROKER_URL`. The Python runtime already
only defaults it when it is absent.

### `DevServer` integration

Add fields:

```ts
private pyprojectSubscriberController?: PyprojectSubscriberDevController;
```

In `_start()`:

1. Load config and env as today.
2. If services orchestrator is used, keep existing flow.
3. If standalone mode:
   - Discover Python build match.
   - Discover pyproject subscribers.
   - If subscribers exist:
     - Inject the local queue vars into `this.envConfigs.runEnv` and
       `this.envConfigs.allEnv` before the Python web `startDevServer` call
       reads env, with the queue vars taking precedence (see Step 5). The web
       server reads `runEnv` at request time, so injecting during `_start()`
       reaches the lazily-started Python process.
     - Create hidden subscriber controller.
     - Create `QueueBroker` with subscriber consumers.
     - Start hidden subscribers.
   - Then run the normal dev command or builder dev server flow.

The exact ordering needs care because the current standalone Python dev server
is started lazily on first request through `builder.startDevServer()`. The queue
env must be injected before that first call.

Recommended ordering:

1. After `await this.updateBuildMatches(vercelConfig, true)`, inspect
   `this.buildMatches` for a Python framework match.
2. If eligible pyproject subscribers exist, configure env and queue broker.
3. Start subscriber workers immediately.
4. Continue watcher setup and ready output.
5. Web server still starts lazily on first request, but with the injected env.

This avoids needing to eagerly start the web framework server.

### Queue route handling

Currently `/_svc/_queues/*` is handled only when `this.orchestrator` exists:

```ts
if (callLevel === 0 && this.orchestrator) {
  const pathname = parsed.pathname || '/';
  if (pathname.startsWith('/_svc/_queues/')) {
    await this.handleQueuesRoute(req, res, pathname);
    return;
  }
}
```

Change this gate to `this.queueBroker`:

```ts
if (callLevel === 0 && this.queueBroker) {
  const pathname = parsed.pathname || '/';
  if (pathname.startsWith('/_svc/_queues/')) {
    await this.handleQueuesRoute(req, res, pathname);
    return;
  }
}
```

`handleQueuesRoute()` already returns `503` when no broker exists, so this is a
safe generalization.

### Shutdown

`DevServer.stop()` already stops:

- Build matches
- Dev process
- Orchestrator
- Queue broker
- HTTP server

Add:

```ts
if (this.pyprojectSubscriberController) {
  ops.push(this.pyprojectSubscriberController.stopAll());
}
```

The controller should:

- Call each worker handle's `shutdown`, if present.
- Remove any stdout/stderr listeners it owns.

Scope note: most teardown is already handled by `@vercel/python`. Its
`installGlobalCleanupHandlers()` registers `SIGINT`/`SIGTERM`/`exit` handlers
that `SIGTERM` then `SIGKILL` every entry in its module-level
`PERSISTENT_SERVERS` map (`packages/python/src/start-dev-server.ts`). Hidden
workers started via `startDevServer` are registered there, so a normal
`vercel dev` exit reaps them without new machinery. `startDevServer`'s returned
`shutdown` is intentionally a no-op (servers persist across requests).

Therefore, for an MVP the controller's `stopAll()` is only needed for graceful
mid-session teardown (e.g. future hot-restart of subscribers), and a full PID
process-group killer is **not** a blocker.

Residual gap (pre-existing parity): workers spawn `detached: true`, and the
builder's `killAll` signals the leader PID, not the whole process group, so
detached grandchildren (e.g. a uvicorn reloader) can be orphaned. This already
applies to the standalone web dev server, so subscribers are no worse. If we
want to close it, extract the orchestrator's group-kill into the shared
`start-python-worker.ts` / a `process-control.ts` helper and have both call it
— a cleanup, not a prerequisite.

## Eligibility Detection

Only enable this feature when all conditions are true:

- `vercel dev` is not in services mode (`shouldUseServicesOrchestrator()` is
  false, i.e. no `experimentalServices` / `experimentalServicesV2`).
- The project has exactly one eligible Python framework build match (see Build
  Match Selection).
- The Python framework is one supported by `@vercel/python` dev server
  startup, such as FastAPI, Flask, Django, or generic Python framework handling.
- `getDevQueueConsumers({ workPath })` returns at least one descriptor, where
  `workPath` is the dev server's resolved project root (`DevServer.cwd`).

Do not enable when:

- The project is services-based.
- The project only has bare `api/**` Python functions.
- The Python build match is not a framework build.
- Subscriber parsing fails. In that case surface the same
  `PYTHON_INVALID_SUBSCRIBER_CONFIG` error used by builds.

## Build Match Selection

Standalone projects should usually have one Python framework build match.

Implementation guidance:

1. Inspect `this.buildMatches`.
2. Find matches whose builder is `@vercel/python`.
3. Ignore middleware matches.
4. Prefer matches with `config.framework` set to a Python framework.
5. If there is exactly one eligible match, use it.
6. If there are multiple eligible matches, skip pyproject subscriber dev and
   print a debug message first. Do not guess.

The first implementation can be conservative:

```ts
function isPythonFrameworkMatch(match: BuildMatch): boolean {
  const use = match.builderWithPkg.builder; // resolved builder
  const isPython =
    match.use === '@vercel/python' || match.builderWithPkg.pkg.name === '@vercel/python';
  const isFramework = typeof match.config?.framework === 'string';
  const isMiddleware = match.config?.middleware === true;
  return isPython && isFramework && !isMiddleware;
}

const pythonMatches = [...this.buildMatches.values()].filter(isPythonFrameworkMatch);
if (pythonMatches.length !== 1) return null;
const pythonBuildMatch = pythonMatches[0];
const pythonWorkPath = this.cwd; // BuildMatch has no per-match workPath in dev;
// dev runs all matches at the project cwd. Use cwd here, and pass the same
// value as `workPath` to getDevQueueConsumers and startPythonWorkerViaBuilder.
```

This matches the intended standalone app shape and avoids starting duplicate
subscriber sets.

Spike first (highest-risk integration point): before building the controller,
confirm on a real no-`vercel.json` FastAPI project that (a) exactly one build
match resolves to `@vercel/python` with `config.framework` populated, and (b)
`runDevCommand()` is a no-op so the web app is served via the per-request
`startDevServer` path (true today because standalone Python has no dev command).
If `config.framework` is not reliably set in dev for framework detection, derive
the framework from the same detection the Python builder uses rather than
assuming `match.config.framework`. Everything downstream depends on this, so
validate it before writing the controller.

## Logging

Hidden subscribers should log with a prefix, but should not be listed as public
services.

Recommended prefix examples:

```text
celery-worker (subscriber)
py:celery-worker
subscriber:celery-worker
```

Use the existing service logger style if it can be extracted. If not, use simple
stdout/stderr forwarding with a stable prefix.

Debug logs should include:

- Subscriber discovery count.
- Subscriber name, topics, and consumer group.
- Worker process startup origin.
- Queue broker dispatch target.
- Subscriber shutdown.

Normal user-facing output should remain minimal. A single line is acceptable:

```text
> Started 1 Python queue subscriber
```

Do not print the hidden subscriber HTTP port in the "Available at" list.

## Error Handling

Subscriber config errors should be fatal, matching build behavior. If
`pyproject.toml` declares subscribers but a worker cannot start, `vercel dev`
should fail rather than silently running only the web app.

Examples:

- Missing `worker.py`: fail with `PYTHON_INVALID_SUBSCRIBER_CONFIG`.
- Invalid `entrypoint`: fail with `PYTHON_INVALID_SUBSCRIBER_CONFIG`.
- Worker process exits before binding: fail `vercel dev` startup.
- Queue send happens before worker origin exists: broker should retry based on
  `retryAfterSeconds` or default retry delay. This is already how
  `QueueBroker` behaves when `getOrigin()` returns null.

## Retry and Delivery Semantics

Current pyproject deploy trigger fields:

- `max_deliveries`
- `retry_after_seconds`
- `initial_delay_seconds`
- `max_concurrency`

Current dev broker supports:

- `retryAfterSeconds`
- `initialDelaySeconds`
- Fixed default `maxDeliveries`
- No explicit `maxConcurrency` enforcement

Implementation should thread through:

- `retry_after_seconds` to `retryAfterSeconds`
- `initial_delay_seconds` to `initialDelaySeconds`
- `max_deliveries` to `maxDeliveries`

`max_concurrency` can be accepted and stored in the consumer config but ignored
initially, with a debug log if desired. Enforcing it would require per-consumer
dispatch concurrency accounting in `QueueBroker`, which is useful but not
required for the first working FastAPI plus Celery local flow.

## Topic Matching

Use the same `topicPatternToRegex()` path as services.

This means:

- Exact topics match exactly.
- `*` expands over valid topic characters.
- Topic characters are constrained by the existing broker regex assumptions.

Pyproject subscriber topic validation currently only checks non-empty strings.
Do not tighten this in dev only. If topic format needs stricter validation, it
should be changed in the shared parser so build and dev match.

## Security and Isolation

The local queue broker is bound inside the `vercel dev` HTTP server and is
addressed through an internal path:

```text
/_svc/_queues
```

The dev token is a fixed local token:

```text
vc-dev-token
```

This already matches the explicit services dev behavior.

Do not send real queue tokens to local subscriber workers unless the user
explicitly configured them in their env. The injected local queue env should
take precedence for the dev process so queue sends stay local.

## Implementation Steps

### Step 1: Add a dev-queue-consumer builder method to `@vercel/python`

In `packages/python/src/index.ts`, export a new builder method that wraps the
existing `getPyprojectSubscribers()` / `safePathSegment()` /
`sanitizeConsumerName()` and returns ready-to-use descriptors:

```ts
export async function getDevQueueConsumers(options: {
  workPath: string;
}): Promise<PythonDevQueueConsumerDescriptor[]> {
  const subscribers = await getPyprojectSubscribers(options.workPath);
  return subscribers.map(s => ({
    consumer: sanitizeConsumerName(`_py_subscribers/${safePathSegment(s.name)}`),
    entrypoint: s.entrypoint,
    variableName: s.variableName,
    topics: s.topics.map(topic => ({ topic, ...s.triggerDefaults })),
  }));
}
```

`PythonDevQueueConsumerDescriptor.topics` is typed as
`DevQueueConsumerTopic[]` imported from `@vercel/build-utils`. The CLI calls this
on the resolved builder instance (`pythonBuildMatch.builderWithPkg.builder`), not
via a static `@vercel/python` import (see "Where subscriber parsing should
live"). Verify the package build emits the method and its types from
`dist/index.js`.

### Step 2: Generalize `QueueBroker`

First add `DevQueueConsumerTopic` to `@vercel/build-utils` (shared across the
CLI↔builder boundary). Then in `packages/cli/src/util/dev/queue-broker.ts`:

1. Add `DevQueueConsumer` (imports `DevQueueConsumerTopic` from
   `@vercel/build-utils`).
2. Change constructor to accept `DevQueueConsumer[]`.
3. Move service-specific topic extraction out of the broker.
4. Honor `maxDeliveries` from topic config.
5. Preserve defaults:
   - `DEFAULT_RETRY_AFTER`
   - `DEFAULT_MAX_DELIVERIES`
   - `DEFAULT_INITIAL_DELAY`
   - `DEFAULT_VISIBILITY_TIMEOUT`
   - `DEFAULT_RETENTION`

Keep `topicPatternToRegex()` exported for unit tests.

### Step 3: Add services adapter

Add `getExperimentalServiceQueueConsumers` (defined in the
`experimentalServices` adapter section above) to a CLI dev helper file, then
update `DevServer` services-mode broker creation:

```ts
const consumers = getExperimentalServiceQueueConsumers({
  services: this.services || [],
  getServiceOrigin: name => this.orchestrator!.getServiceOrigin(name),
});

if (consumers.length > 0) {
  this.queueBroker = new QueueBroker(consumers);
}
```

This should be behavior-preserving for existing worker service tests.

### Step 4: Add pyproject subscriber controller

Create:

```text
packages/cli/src/util/dev/pyproject-subscribers.ts
```

Responsibilities:

- Use the builder resolved for the selected `BuildMatch`.
- Get descriptors from the builder's `getDevQueueConsumers({ workPath })`.
- Start hidden workers through `startPythonWorkerViaBuilder()`.
- Return `DevQueueConsumer[]`.
- Stop hidden workers.

Pseudo-code:

```ts
export async function createPyprojectSubscriberDevController(options: {
  workPath: string; // DevServer.cwd
  repoRoot: string;
  proxyOrigin: string;
  runEnv: NodeJS.ProcessEnv;
  pythonBuildMatch: BuildMatch;
}) {
  const builder = options.pythonBuildMatch.builderWithPkg.builder;
  if (typeof builder.getDevQueueConsumers !== 'function') return null;

  const descriptors = await builder.getDevQueueConsumers({
    workPath: options.workPath,
  });
  if (descriptors.length === 0) return null;

  const framework =
    typeof options.pythonBuildMatch.config?.framework === 'string'
      ? options.pythonBuildMatch.config.framework
      : 'python';
  const handles = new Map<string, PythonWorkerHandle>();

  const subscriberEnv = cloneEnv(options.runEnv, {
    FORCE_COLOR: process.stdout.isTTY ? '1' : '0',
    BROWSER: 'none',
    VERCEL_HAS_WORKER_SERVICES: '1',
    VERCEL_SERVICE_TYPE: 'worker',
    VERCEL_SERVICE_TRIGGER: 'queue',
    VERCEL_QUEUE_BASE_URL: `${options.proxyOrigin}/_svc/_queues`,
    VERCEL_QUEUE_TOKEN: 'vc-dev-token',
  });

  const consumers: DevQueueConsumer[] = descriptors.map(d => ({
    name: d.consumer,
    topics: d.topics,
    getOrigin: () => handles.get(d.consumer)?.origin ?? null,
  }));

  return {
    consumers,
    hasSubscribers: true,
    async startAll() {
      let needsSync = true; // sync deps once for the shared project
      for (const d of descriptors) {
        const handle = await startPythonWorkerViaBuilder({
          builder,
          entrypoint: d.entrypoint,
          workPath: options.workPath,
          repoRoot: options.repoRoot,
          framework,
          handlerFunction: d.variableName,
          consumerName: d.consumer,
          env: subscriberEnv,
          syncDependencies: needsSync,
          serviceName: `py-sub:${d.consumer}`,
          onStdout: makePrefixedSink(d.consumer, process.stdout),
          onStderr: makePrefixedSink(d.consumer, process.stderr),
        });
        needsSync = false;
        handles.set(d.consumer, handle);
      }
    },
    async stopAll() {
      await Promise.all(
        [...handles.values()].map(h => h.shutdown?.())
      );
    },
  };
}
```

Reuse Python version / dependency behavior by going through the builder's
`startDevServer` (inside the shared helper). Do not spawn `uvicorn` or Celery
directly. `cloneEnv(options.runEnv, {...queueVars})` places the queue vars last
so they override inherited values (same precedence rule as Step 5).

### Step 5: Inject standalone queue env

In `DevServer`, after subscriber discovery and before the web builder
`startDevServer()` can run, inject into `runEnv` and `allEnv`:

```ts
const queueEnv = {
  VERCEL_HAS_WORKER_SERVICES: '1',
  VERCEL_QUEUE_BASE_URL: `${this.address.origin}/_svc/_queues`,
  VERCEL_QUEUE_TOKEN: 'vc-dev-token',
};

// `cloneEnv` applies later args last (Object.assign reduce), so `queueEnv`
// MUST come last to win over inherited/cloud values.
this.envConfigs.runEnv = cloneEnv(this.envConfigs.runEnv, queueEnv);
this.envConfigs.allEnv = cloneEnv(this.envConfigs.allEnv, queueEnv);
```

Precedence is load-bearing here. `cloneEnv(...envs)` reduces with
`Object.assign(obj, env)`, so the **last** argument wins
(`packages/build-utils/src/clone-env.ts`). `VERCEL_QUEUE_BASE_URL` and
`VERCEL_QUEUE_TOKEN` must override any inherited value (process env or pulled
cloud env); otherwise `vercel dev` could publish test messages to a real remote
queue. Putting `queueEnv` first (as an earlier draft did) would let cloud values
win — the exact failure mode to avoid.

For `VERCEL_HAS_WORKER_SERVICES`, setting it to `1` is required when subscribers
exist.

Do not force `CELERY_BROKER_URL` if the user has set one. The Python worker
runtime already defaults it only when absent, so this override list deliberately
excludes it.

### Step 6: Initialize standalone queue broker

In standalone mode:

```ts
const controller = await createPyprojectSubscriberDevController(...);
if (controller) {
  this.pyprojectSubscriberController = controller;
  this.queueBroker = new QueueBroker(controller.consumers);
  await controller.startAll();
}
```

The broker can be created before `startAll()`. Its `getOrigin()` functions can
return `null` until workers bind. The broker already retries when origin is not
available.

### Step 7: Generalize queue route handling

Change the route gate to use `this.queueBroker` instead of `this.orchestrator`.

This allows standalone Python subscribers to use:

```text
/_svc/_queues/api/v3/topic/<topic>
```

without enabling services mode.

### Step 8: Shutdown cleanup

Add controller cleanup in `DevServer.stop()`:

```ts
if (this.pyprojectSubscriberController) {
  ops.push(this.pyprojectSubscriberController.stopAll());
}
```

This is sufficient for the MVP: `@vercel/python`'s `installGlobalCleanupHandlers`
already SIGTERM/SIGKILLs all `PERSISTENT_SERVERS` on `SIGINT`/`SIGTERM`/`exit`,
which covers the hidden workers on normal `vercel dev` exit (see Shutdown).

Optional hardening (not a blocker): to also reap detached grandchildren (e.g. a
uvicorn reloader) on graceful stop, extract the orchestrator's process-group
termination into a shared helper and call it from both paths:

```text
packages/cli/src/util/dev/process-control.ts
```

Candidate functions: `terminateProcessGroup(name, pid, proc?)`,
`forceKillProcessGroupSync(pid)`, `waitForExit(pid, proc, timeoutMs)`. This is
the same pre-existing gap the standalone web dev server has today, so defer it
unless we choose to fix both at once.

## Test Plan

### Unit tests: Python `getDevQueueConsumers`

Existing tests in `packages/python/test/unit.test.ts` already cover the parser
and build output behavior. Add tests for the new builder method:

- `getDevQueueConsumers({ workPath })` returns `[]` when there is no
  `pyproject.toml` or no `tool.vercel.subscribers`.
- Each descriptor's `consumer` equals
  `sanitizeConsumerName('_py_subscribers/' + safePathSegment(name))` — i.e.
  identical to what `build` emits for the same subscriber.
- `entrypoint` / `variableName` resolve from the `module:object` entrypoint.
- `topics` carries `retryAfterSeconds` / `initialDelaySeconds` / `maxDeliveries`
  / `maxConcurrency` from `triggerDefaults`.
- Invalid config throws `PYTHON_INVALID_SUBSCRIBER_CONFIG` (shared with build).

### Unit tests: QueueBroker

Add tests in CLI dev tests for generalized consumers:

- Broker registers generic consumers without `ExperimentalService`.
- `maxDeliveries` from consumer topic config is honored.
- `retryAfterSeconds` from consumer topic config is honored.
- `initialDelaySeconds` from consumer topic config is honored.
- Existing topic wildcard behavior still works.
- Existing service consumer adapter returns the same consumer names and topics
  as before.

### Integration test: standalone FastAPI plus generic `subscribe`

This is the smallest test because it avoids Celery dependency behavior while
still testing pyproject subscriber discovery and queue dispatch.

Fixture:

```text
packages/cli/test/dev/fixtures/pyproject-subscriber/
├── main.py
├── worker.py
├── pyproject.toml
├── uv.lock
└── .gitignore
```

`main.py`:

```py
import os
from fastapi import FastAPI
from vercel.workers import send

app = FastAPI()

@app.post("/enqueue")
def enqueue():
    return send("tasks-topic", {"value": 42})
```

`worker.py`:

```py
import json
import os
from vercel.workers import subscribe

RESULT_DIR = os.path.join(os.path.dirname(__file__), ".results")

@subscribe(topic="tasks-topic")
def handle(message, metadata):
    os.makedirs(RESULT_DIR, exist_ok=True)
    with open(os.path.join(RESULT_DIR, "result.json"), "w") as f:
        json.dump({"message": message, "metadata": metadata}, f)
```

`pyproject.toml`:

```toml
[project]
name = "pyproject-subscriber"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi==0.133.0",
  "vercel-workers>=0.0.10",
]

[tool.vercel]
entrypoint = "main:app"

[tool.vercel.subscribers.worker]
entrypoint = "worker:handle"
topics = ["tasks-topic"]
```

Why `entrypoint = "worker:handle"` works even though `handle` is a function, not
an app: the subscriber parser only validates the `module:object` shape and that
the file exists — it does not require `handle` to be an app. At runtime, because
`VERCEL_SERVICE_TYPE=worker`, `vercel_runtime.dev` calls
`maybe_bootstrap_worker_service_app(mod)` before normal app resolution. Importing
`worker.py` runs the `@subscribe` decorator, registering the subscription, and
`_bootstrap_generic_worker_app()` returns a callback ASGI app from
`has_subscriptions()`. The `handle` variable itself is never used as the app, so
the entrypoint only needs to point at an importable module that registers
subscriptions. This is the same mechanism the `services-worker` fixture relies
on, so it is already proven in dev.

Test:

1. Start `vercel dev --local`.
2. POST `/enqueue`.
3. Poll for `.results/result.json`.
4. Assert the message and metadata.
5. Kill dev.

### Integration test: standalone FastAPI plus Celery

Add a second fixture once the generic path is green.

This should mirror `packages/python/test/fixtures/65-celery-subscriber` but as a
CLI dev fixture.

Test:

1. Start `vercel dev --local`.
2. POST `/enqueue`.
3. Poll `/status/<request_id>` or a side-effect file.
4. Assert the Celery task executed.
5. Confirm the web process did not require an explicit `CELERY_BROKER_URL`.

This verifies:

- `VERCEL_HAS_WORKER_SERVICES=1` was injected into web dev env.
- `vercel-workers` was installed for dev.
- Celery `vercel://` transport was activated.
- Queue send went to local `VERCEL_QUEUE_BASE_URL`.
- Hidden worker process bootstrapped Celery callback app.

### Regression test: existing services workers

Run the existing CLI dev integration:

```text
[vercel dev] web send() triggers exact and wildcard worker execution
```

This verifies the `QueueBroker` generalization did not break explicit
`experimentalServices`.

### Manual test

Use a real FastAPI plus Celery project:

```sh
pnpm build
node packages/cli/dist/index.js dev /path/to/fixture --local --debug
```

Then:

```sh
curl -X POST http://localhost:3000/enqueue
curl http://localhost:3000/status/<request_id>
```

Debug output should show:

- Subscriber discovery.
- Queue broker initialized.
- Queue message stored.
- CloudEvent dispatched to the hidden subscriber origin.
- Message acknowledged.

## Edge Cases

### Subscriber process starts before web process

This is acceptable. The hidden worker only needs to accept callbacks. The web
process starts lazily on first HTTP request and publishes to the broker.

### Web process publishes before worker is ready

The broker handles missing origins by retrying later. Starting hidden workers
before ready output should make this rare.

### Multiple subscribers on the same topic

Each subscriber should become a separate consumer group. One message should be
delivered once to each matching consumer group, matching the broker's existing
group model.

### One subscriber with multiple topics

Build supports multiple topics per Python subscriber. Dev should register one
consumer group per topic with the same consumer name, matching the existing
broker model.

### Duplicate subscriber names

TOML object keys cannot represent duplicate names. No additional handling is
needed.

### Consumer name collisions

Use the same `safePathSegment()` and `sanitizeConsumerName()` path as build.
If two different subscriber names somehow map to the same consumer, fail during
controller creation with a clear error.

### Custom `CELERY_BROKER_URL`

If the user sets `CELERY_BROKER_URL`, do not override it. This means their app
may publish to Redis or another broker instead of local Vercel Queues. That is
consistent with normal env precedence, but document that local Vercel Queues
requires either no `CELERY_BROKER_URL` or `CELERY_BROKER_URL=vercel://`.

### Remote queue env values

`VERCEL_QUEUE_BASE_URL` and `VERCEL_QUEUE_TOKEN` should be overridden for this
dev feature so local sends do not hit remote queues by accident.

### File changes

Existing dev file watcher rebuild behavior should be enough for the web app,
but hidden subscriber workers are persistent. A first implementation can require
restarting `vercel dev` when worker code changes.

Better follow-up:

- Watch files.
- Restart hidden subscriber workers when `pyproject.toml` or subscriber
  entrypoint dependencies change.

### `pyproject.toml` changes

If `tool.vercel.subscribers` changes while `vercel dev` is running, the initial
implementation can require restart. A later enhancement can re-run discovery
and reconcile workers.

### Windows support

Use existing process spawning and termination helpers. Avoid shell-specific
commands. Ensure path handling uses `path.join`, `path.relative`, and POSIX
paths only where the Vercel function path or consumer name intentionally uses
forward slashes.

## Decisions

These were open questions, now resolved for implementation.

### Parsing source — DECIDED

Add a `getDevQueueConsumers({ workPath })` method to the `@vercel/python`
builder and call it on the resolved builder instance
(`pythonBuildMatch.builderWithPkg.builder`). Do not statically import
`@vercel/python` internals from the CLI bundle (version-skew + boundary
violation). The method reuses `getPyprojectSubscribers` / `sanitizeConsumerName`
internally so dev and build agree on consumer names.

### Worker startup — DECIDED

Extract a single `startPythonWorkerViaBuilder()` helper and use it from both
`ServicesOrchestrator.tryStartWithBuilder` and the subscriber controller. One
startup/lifecycle path, no duplication.

### Shutdown scope — DECIDED

Rely on `@vercel/python`'s global `PERSISTENT_SERVERS` reaper for exit; add
`controller.stopAll()` for graceful teardown. Defer process-group hardening
(pre-existing parity gap with the standalone web server).

### Should hidden subscribers be printed? — DECIDED

Print one concise line (`> Started N Python queue subscriber(s)`). Do not list
hidden ports under "Available at".

### Should `max_concurrency` be enforced in dev? — DEFERRED

No, not in the first pass. Carry it in `DevQueueConsumerTopic` so it can be
enforced later without changing discovery. First pass focuses on correct local
delivery.

### Should generic `@subscribe` entrypoints (no exported app) be supported? — DECIDED

Yes. Worker bootstrap uses registered subscriptions, not an exported app (see
the generic fixture note). It is the simplest integration test and exercises the
hidden worker path.

## Still Needs Validation (spike before/early in implementation)

- That a no-`vercel.json` FastAPI project yields exactly one `@vercel/python`
  framework build match in dev with `config.framework` populated, and that
  `runDevCommand()` is a no-op so the web app uses the per-request
  `startDevServer` path. This is the riskiest assumption; see Build Match
  Selection. If `config.framework` is unreliable, derive the framework the same
  way the Python builder's dev server does instead of reading `match.config`.

## Suggested Implementation Order

0. Spike: confirm the standalone Python build-match / framework / lazy
   `startDevServer` assumptions (see Still Needs Validation).
1. Add `DevQueueConsumerTopic` to `@vercel/build-utils`.
2. Add the `getDevQueueConsumers` method to the `@vercel/python` builder.
3. Generalize `QueueBroker` to `DevQueueConsumer[]`.
4. Extract `startPythonWorkerViaBuilder()` and refactor the orchestrator to use
   it (keep existing services tests passing).
5. Add the services adapter (`getExperimentalServiceQueueConsumers`).
6. Change the queue route gate from `this.orchestrator` to `this.queueBroker`.
7. Add the pyproject subscriber controller.
8. Inject standalone queue env (queue vars last) before web Python
   `startDevServer`; create the broker; start hidden workers.
9. Add generic `@subscribe` integration fixture.
10. Add FastAPI plus Celery integration fixture.
11. Add changeset.

## Files Likely To Change

Expected implementation files:

- `packages/build-utils/src/types.ts` (add `DevQueueConsumerTopic`)
- `packages/python/src/index.ts` (add `getDevQueueConsumers`)
- `packages/cli/src/util/dev/queue-broker.ts` (accept `DevQueueConsumer[]`)
- `packages/cli/src/util/dev/start-python-worker.ts` (new shared helper)
- `packages/cli/src/util/dev/services-orchestrator.ts` (refactor
  `tryStartWithBuilder` onto the shared helper; add the services adapter or put
  it in a small helper imported by `server.ts`)
- `packages/cli/src/util/dev/pyproject-subscribers.ts` (new controller)
- `packages/cli/src/util/dev/server.ts` (env injection, broker creation, route
  gate, shutdown wiring)
- `packages/cli/test/dev/integration-5.test.ts` or a nearby integration file
- `packages/cli/test/dev/fixtures/pyproject-subscriber/*`
- `packages/cli/test/dev/fixtures/pyproject-celery-subscriber/*`
- `.changeset/<name>.md` (include `@vercel/build-utils`, `@vercel/python`; the
  CLI is unpublished so it is not listed, but its behavior is covered)

Possible refactor files:

- `packages/cli/src/util/dev/process-control.ts` (only if closing the
  detached-grandchild gap)
- `packages/cli/src/util/dev/service-logger.ts` (reuse for prefixed worker logs)

## Success Criteria

The feature is complete when:

- A standalone FastAPI plus Celery project with `tool.vercel.subscribers` works
  locally with `vercel dev --local`.
- Queue sends from the web process hit `/_svc/_queues`.
- The dev queue broker dispatches `queue/v2beta` callbacks to hidden subscriber
  workers.
- Subscriber workers execute Celery or generic `@subscribe` handlers.
- Messages are acknowledged through the local broker.
- Existing `experimentalServices` queue worker tests continue to pass.
- Invalid subscriber config fails `vercel dev` with the same validation behavior
  as `vercel build`.
- No user-visible service routes are added for hidden subscribers.
