# Billing Model and Platform Boundaries

Use this guide to turn code risks into verifiable usage and conditional monthly costs. It does not store a fixed price list. The official sources below were checked on 2026-10-08; each actual review must still verify current prices, defaults, and the target plan.

## Confirm Metering First

| Product | Usage to estimate and common mistakes | Official source |
| --- | --- | --- |
| Workers / Pages Functions | Worker entry requests and total CPU time; time waiting for external services is not CPU time | [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Worker Service Binding | Under Standard pricing, binding calls do not add Worker request fees, but related CPU usage accumulates. Do not count every call edge as another billable entry request; verify legacy plans separately | [Service bindings billing](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings) |
| Durable Objects | Alarm/HTTP/RPC metering, duration while the object cannot hibernate, storage operations, and capacity. Distinguish SQLite from legacy KV storage backends; `setAlarm` also incurs write metering. Do not double-count overlapping duration for concurrent requests | [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Workers KV | Per-key reads, writes, deletes, list operations, and storage; bulk writes to multiple keys still count as multiple keys | [KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/) |
| D1 | Actual scanned rows, written rows, and storage. Returned rows are not scanned rows, and index maintenance may add writes | [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| Queues | Message writes, reads, deletes, and retry reads, adjusted for message-size billing chunks. A batch is not one operation, and DLQ transfers also incur usage | [Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/) |
| Workers AI / external AI | Model-specific input/output tokens, neurons, or other units. List external providers and tool services separately rather than mixing prices | [Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/); the external provider's current official price list |

For continuously running DOs, estimate the actual time the object cannot hibernate, not just the work inside `alarm()`. Convert object active intervals to GB-s using the official memory metering rules; do not apply Workers CPU pricing to DO duration.

## Derive Usage from Code

Use a 30-day stress scenario by default: `T = 30 × 24 × 60 × 60 = 2,592,000 seconds`. State whether intervals, object counts, user counts, and rates come from code, known usage, or assumptions.

- Periodic chains: `invocations ≈ active chains × T / effective interval in seconds`. Shorten the active window and cap attempts for deadlines, remaining counts, no-work termination, or deactivation. Execution time, backoff, and serialized alarms within an object affect the effective interval.
- Frontend polling: `requests ≈ Σ(actual polling seconds per user / effective interval)`, plus failure retries. Only an explicit continuously online stress assumption justifies counting every user for the entire month.
- Request hot paths: `writes = entry requests × keys/rows written per request`, plus retries, downstream triggers, and flush jobs.
- D1: `scanned rows = query count × scanned rows per query`; `written rows = execution count × written rows per execution`, including indexes, triggers, and other effects. When scan volume is unproven, express it as a function of table size.
- Bounded retries: one initial attempt plus at most `r` retries gives `r + 1` attempts. Multiply independent nested layers to estimate amplification, then check whether new events reset the counter.
- Branching tasks: with `b` successors per round and at most `k` rounds, estimate total tasks using `1 + b + … + b^k`. Model serial cycles separately from parallel fan-out.
- AI: sum `input tokens × input rate + output tokens × output rate` across rounds using the actual model and context, adjusting for pricing units. Full-history replay means inputs may grow each round. Count tool reads/writes and model failure retries separately.

Retries without a delay do not imply infinitely many calls per second; do not calculate `T / 0`. Throughput depends on request latency, concurrency, and platform limits. When those parameters are missing, use a rate variable or an explicit stress assumption.

These scale examples check arithmetic only; they do not represent any project's size or bill:

| Scenario | 30-day usage, excluding extra retries |
| --- | --- |
| 1 object running an alarm every 60 seconds with work throughout | Approximately 43,200 alarm invocations |
| 1,000 objects running alarms every 60 seconds with work throughout | Approximately 43,200,000 alarm invocations |
| 1,000 pages polling every 5 seconds continuously all month | Approximately 518,400,000 frontend requests |
| One full-table UPDATE per second on 1,000,000 rows, with every row counted as written each time | Approximately 2,592,000,000,000 row writes, plus indexes and other effects |

## Convert Usage to Cost

For each metered dimension, record the plan, rate `p`, rate unit `u`, allowance `A`, allowance period, existing usage `B`, risk-related usage `R`, billing rounding rules, and source date.

Illustrative formula for continuous usage with one linear rate:

```text
C(Q) = max(0, Q - A) / u × p
Incremental cost of this risk = C(B + R) - C(B)
```

Replace `C` with the actual official rules for tiers, minimum billing units, rounding, daily allowances, and product-specific periods. Total monthly cost may also include base subscriptions and other products. State whether the reported amount is incremental risk cost or the account total.

- Allowances are generally shared with other account usage. Do not deduct the same allowance separately for every finding. If `B` is unknown, show scenarios with the allowance still available and already exhausted.
- Daily free allowances cannot simply be treated as monthly allowances. Free plans may reject operations at their limits; explain availability risk and any other billable parts of the chain. Do not apply paid overage rates and claim that a free plan automatically incurs charges.
- When the same chain appears in alarm, Queue, retry, or other categories, deduplicate its entry points and usage. Still count actual metering by each distinct product within the chain.
- If code has no bound and traffic, object counts, or throughput limits are unknown, state "No upper bound enforced by the code," followed by a 30-day stress scenario with assumptions. Do not label an arbitrary scenario amount as a definitive worst-case monthly bill.
- Give a finite upper bound only when supported by known limits on traffic and work. If CPU, duration, tokens, or rows are unknown, distinguish calculated charges from omitted dimensions.
- Use USD or the provider's original currency. Convert only when requested and after verifying the exchange rate. Unverified incident amounts cannot be directly extrapolated to the current project's costs.

## Platform Bounds and Application Bounds

The following mechanisms affect conclusions. Verify current documentation when relevant rather than treating defaults as permanent constants.

- **Platform alarm retries are bounded.** At the verification date, the docs describe exponential backoff with up to 6 retries after failure. Application calls to `setAlarm` introduce successor scheduling. Alarm execution is at least once, `getAlarm` may return `null` while a handler runs, and the constructor runs first when an object wakes. An absent current alarm does not prove that no chain is pending. `deleteAlarm` only prevents failure retries on a best-effort basis; persistent stop state and idempotency checks are still needed. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- **Platform Queue retries are also bounded.** At the verification date, `max_retries` defaults to 3. Without a DLQ, messages reaching the retry limit are deleted. A missing DLQ is a failure-recovery gap, not proof of infinite retries. Republishing with `send` or automatic DLQ feedback requires task-level bounds. [Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/), [Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- **Per-invocation limits do not cap an entire chain across events.** Check applicable CPU, subrequest, duration, and Worker-call limits. If a limited invocation creates another message, alarm, or request, successor work still incurs usage. Do not claim every Worker cycle must be infinite or describe an invocation limit as an account spending cap. [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- **Budget alerts are not an account-wide hard cap.** Current documentation describes notifications when account usage-based spending crosses a threshold. Do not assume automatic shutdown or treat one product's free limits as a hard cap covering every account charge. Prove the application chain itself can stop. If the user has a separate shutdown mechanism, inspect its latency and coverage of background alarms, Queues, and AI. [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)

Suggested circuit breakers, budgets, and aggregation mechanisms also consume requests or writes. In particular, a cost guard that adds a DO/KV write to every request can introduce the category 6 risk itself. Explain these added costs and any necessary business behavior when proposing fixes.
