# Job application agent

Existing TypeScript + Playwright + SQLite application with credential-free discovery and a new **runtime OpenAI Responses API agent**. `agent-evaluate` and `agent-apply` use an LLM; the existing discovery and deterministic application commands are preserved. **All real submissions are disabled during development**, including the old single-job permit. Discovery and review do not submit applications.

## Runtime LLM agent

See [the detailed runtime-agent setup and safety documentation](docs/runtime-agent.md). Install `openai` and `pdfjs-dist`, configure the model/key/current prices using `.env.example`, then:

```powershell
node --env-file=.env src/cli.ts agent-evidence
node --env-file=.env src/cli.ts agent-evaluate 'EXACT_JOB_ID'
node --env-file=.env src/cli.ts agent-apply 'EXACT_JOB_ID'
```

The last command is a real model-driven browser loop in dry-run mode. It uses validated tools and approved evidence, handles supported multi-step forms/validation, and stops before final submission. `npm.cmd run demo:agent` demonstrates the same loop on a synthetic local form using an explicitly labelled mock model. `node --env-file=.env src/agent/demo.ts --openai` uses the actual configured model on that local form. Runtime model commands require API access; there is no silent mock fallback. The login task still runs discovery/review only.

## Discover and review

```powershell
Set-Location C:\Users\johnl\job-agent
node src/cli.ts discover
node src/cli.ts review
# Review one stored job:
node src/cli.ts review 'EXACT_JOB_ID'
# Regenerate/display the application table:
node src/cli.ts status
```

No Adzuna, API keys, paid aggregator subscriptions, login credentials or environment secrets are needed for discovery. No new dependencies were added for these adapters.

| Source | Default configuration | Behavior |
|---|---|---|
| Remote OK | Enabled | Public API, role and explicit US/worldwide remote filters; excludes metadata entry |
| Arbeitnow | Optional, disabled | Public paginated API; Austin or explicitly US-eligible remote only |
| Greenhouse | 16 employers enabled | Public Job Board API |
| Lever | 3 employers enabled | Public Postings API |
| Ashby | 15 employers enabled | Public postings with disclosed compensation |
| SmartRecruiters | Optional Bosch source, disabled | Public list/detail Posting API, no authentication |
| Netflix legacy Lever board | Disabled | Verified 404; current portal is different and no replacement API was guessed |

Edit `config/sources.json` to enable optional feeds or change employers. The **34 enabled technology employers**, plus optional Bosch, have observed board identifiers with `verifiedUrl` and `verifiedAt` metadata. See [the complete evidence catalog](docs/employer-sources.md). Verification checked public employer pages/titles or employer-site redirects; it does not claim every API endpoint has been live-tested. APIs can change and each run reports their actual status.

Arbeitnow primarily covers Europe. A remote flag or English description does **not** establish US eligibility. It is normal to get few or zero qualifying jobs from it. Its pages are bounded by `maxPages` (default 2, maximum 10), and the adapter follows page numbers only on the known public endpoint. SmartRecruiters uses a verified company identifier, paginated list requests, then details for matching titles. It takes application URLs only from published response fields, never constructs candidate/application links. Public unauthenticated access is documented by [SmartRecruiters](https://developers.smartrecruiters.com/docs/authentication). Enable Bosch after checking local API reachability; internal/feed APIs requiring credentials are not used.

References: [Remote OK API](https://remoteok.com/api), [Remote OK terms](https://remoteok.com/legal), [Arbeitnow API documentation](https://www.arbeitnow.com/blog/job-board-api), [SmartRecruiters endpoints](https://developers.smartrecruiters.com/docs/endpoints), [Greenhouse](https://docs.greenhouse.io/job-board), [Lever](https://github.com/lever/postings-api), [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api).

## Source failures and counts

Each source runs independently. Jobs are saved as they arrive; an employer 404 or later-page failure cannot delete previously saved jobs or cancel remaining employers. Failed jobs within a result set are also isolated. Successful sources with zero matching jobs still count as successfully fetched sources.

`discover` prints a final `DISCOVERY_SUMMARY` JSON line and writes:

- `data/discovery/latest.json`: status, exit code, timestamps, per-employer results and errors.
- `data/discovery/sources.csv`: provider, employer, status, matching count, persisted count, request attempts, and failure/skip reason.
- SQLite events and `data/agent.log`: individual failures, retries, terms metadata and final summary.

Counts describe matching records and persistence/upsert operations for **this run**, not all open jobs worldwide or newly inserted unique jobs. Existing jobs remain available for review even after a total discovery failure.

| Discovery outcome | CLI exit code | Login scheduler outcome |
|---|---:|---|
| All enabled sources succeeded | 0 | Success |
| Some sources succeeded, or a page yielded jobs before a later failure | 2 | Completed with warnings; review continues; task exits 0 |
| Every enabled source failed, or none is enabled | 1 | Failure; review still runs; task exits 1 |

Disabled sources are explicitly marked skipped and do not count as failed. The scheduler records each stage's original exit code and parsed discovery summary in `data/scheduler/latest-run.json`. Other nonzero CLI stage results remain errors, and a review failure always makes the scheduled run fail.

404, 401, 403 and 429 stop that source without retrying. Transient connection/timeouts and selected server errors get at most three attempts with backoff; no authentication or restrictions are bypassed. Rate-limit errors are left for a later run.

## Access conditions, rate limiting and attribution

Discovery reads `robots.txt` before each origin's first API request. Disallowed paths, forbidden/unreadable policies or access controls stop the affected source. A missing robots file (404) permits the documented public endpoint. There is no proxy rotation, CAPTCHA solving, user-agent impersonation or login-wall bypass. The client identifies itself as `JobApplicationAgent`.

Requests to the same host are spaced by at least one second or the published robots crawl delay, whichever is longer. JSON responses are cached in `data/http-cache`: one hour for Remote OK and Arbeitnow, 15 minutes for employer APIs. Cached results still require a current permitted robots policy. Repeated scheduled runs reuse cache instead of repeatedly downloading the feed. Employer-specific terms can impose additional conditions; disable any source you are not permitted to use. Discovery is for personal job search, not model training or republication.

Remote OK's API header asks consumers to name **Remote OK** and link back to the original posting with a normal follow link. The adapter retains that posting URL and source name, records the returned legal header, and exports attribution columns. `data/applications.html` renders normal source links without `nofollow`; CSV/JSON also retain the attribution name and URL. No Remote OK logo is used. Preserve this attribution if you share or publish the report. Arbeitnow source links are retained too.

## Ranking, compensation and deduplication

Target titles: SDE II, Software Engineer II, Senior Software Engineer, distributed systems, backend/infrastructure, AI platform and cloud engineering. Ranking favors Austin and explicit US-remote roles, then matches your DynamoDB, AWS, distributed systems, IoT orchestration, WorkcellAI and observability experience. Other native employer locations remain visible with `LOCATION_REVIEW`; they are not automatically application-eligible.

The target is **$250K+ total compensation**, with higher disclosed amounts prioritized at $300K+. A reported salary range is **not** treated as total compensation. Salary records retain currency, prediction and period qualifiers; missing salary is flagged, and predicted data is not treated as employer-disclosed pay. Equity and bonuses are never invented. Unknown salary does not exclude an otherwise strong candidate by default. Your separately approved $300K+ total compensation answer remains unchanged; it is not reused as a base-salary answer.

SQLite deduplication uses canonical URLs and employer + actual requisition IDs when available. Known tracking parameters and ATS `/apply` variants are normalized only for identity, while the supplied application URL is retained for navigation. Similar titles alone never merge different requisitions. Source aliases/provenance are retained in `job_aliases`, `job_identities`, and `job_sources`; application history remains attached to the canonical job. If a previously separate feed posting is later resolved, its aliases are joined without permitting a duplicate submission. The persistent database is migrated in place.

Feed links remain source links unless a supplied destination is a recognized ATS URL whose tenant matches the employer. No direct employer link is invented. Unresolved feed records receive `APPLICATION_URL_UNRESOLVED`, remain reviewable, and cannot be auto-applied. Native employer APIs provide their original application URLs. Custom employer domains and ambiguous feed redirects currently require manual verification or a tested adapter.

When a board's location field contains only a workplace label such as Hybrid or In-Office, explicit `Available Locations:` or `Location:` headers in the posting description can supply the actual cities. HTML-escaped headers are decoded, and previously stored jobs are reranked on read. Incidental company-office mentions do not establish job location, and an already explicit city is not overwritten.

## Reports and application safety

`data/applications.csv`, `data/applications.json`, and `data/applications.html` contain company, title, location, disclosed compensation, status, error reason, selected resume, job/application/source URLs, confirmation URL, screenshot, and update time. The report also includes `submitted_date` (America/Chicago) and `submitted_at` (UTC ISO timestamp), recorded only after the configured confirmation is observed. Historical rows without a recorded timestamp remain blank rather than getting invented dates. Review and status regenerate the reports.

Existing approved facts/answers in `config/profile.json` and `config/shared.json` and your two local resumes are preserved. Selection chooses the distributed-systems or AI-platform resume by job relevance. Shared questions require exact normalized approved label matches; unknown required, legal, eligibility or demographic answers are never guessed. Only supported standard forms can be filled. CAPTCHA, unsupported widgets/iframes, multi-step forms and unrecognized layouts stop the job and record the reason.

The ten-attempt-per-Chicago-day application cap, transactional reservation, duplicate protection, persistent authenticated browser sessions, resume uploads, screenshots and observed-confirmation requirement remain. Pending/uncertain submissions block retries. A failed source or absent confirmation never becomes `submitted`.

### Dry-runs and submissions

```powershell
# Inspect one form; with approved answers, fill/upload but stop before submit:
node src/cli.ts apply 'EXACT_JOB_ID' --headless
# Inventory only, even when reusable answers are enabled:
node src/cli.ts apply 'EXACT_JOB_ID' --inspect --headless
# Batch preview with reusable answers:
node src/cli.ts batch --headless --limit 10
# Discovery plus application preview (now defaults to dry-run):
node src/cli.ts start-search
```

Filling fields/uploading can transmit information or create a draft even without clicking submit. Discovery/review alone do not fill forms. First inspect the form inventory in `data/artifacts` if you only want an inventory.

Single-job `apply` now uses an enabled shared policy automatically when no per-job approval exists; `--shared` explicitly selects shared answers, while `--inspect` records only the inventory. Artifacts include control roles, accessibility relationships, surrounding question text and a companion `*.page.json` identifying the actual forms and final URL. Standard ARIA comboboxes are supported by selecting an exact approved visible option and verifying the selected value. Anonymous React Select validation inputs are associated only with their actual sibling controller and must still pass native validation; they are never filled with fabricated values. Unsupported or ambiguous choices stop the job. `jobIds` on a shared answer limits it to named jobs, useful for a specifically approved consent checkbox. A privacy acknowledgment is not inferred from a generic checkbox label.

Bulk live submissions remain disabled with `config/submission.json` set to `enabled:false`. Normal live CLI paths require `--submit`, `JOB_AGENT_ENABLE_SUBMISSION=YES`, and explicitly enabling that file, in addition to the existing per-job or shared-policy approvals. A bare `start-search` defaults to preview. Tests submit only to local synthetic fixtures.

### Automatic routine answers and the single live test

Your shared policy now authorizes the agent to derive discovery-source questions from actual posting provenance and acknowledge ordinary candidate/applicant privacy notices. It does not invent referrals or personal qualifications. Privacy automation checks the surrounding question text; a generic confirmation label alone is insufficient. Marketing, newsletter, talent-pool, future-opportunity, arbitration and certification combinations are excluded from that routine rule. Explicit approved answers take precedence, and unknown required factual answers still stop that job. Automatic decisions are logged by field/rule (without answer values) and saved in `*.automatic-answers.json` artifacts.

The earlier Cloudflare one-job permit has been cleared for runtime-agent development. After a future explicit authorization, an exact job ID can be added to `singleJobIds`; only then can this legacy one-job command submit:

```powershell
node src/cli.ts apply 'greenhouse:cloudflare:8174207' --shared --headless --submit-once
```

This command can submit **one real application**. The permit cannot authorize another job or a batch. Duplicate/pending/uncertain reservations are checked before opening the browser and again atomically before submission, so a permit cannot cause a second submission attempt. Preflight failures before reservation may be fixed and retried; an uncertain outcome must be reconciled manually. `--submit-once` does not enable global submissions, does not require changing the session environment, and is never used by the scheduled task. The selected resume, approved personal facts, required-question checks, CAPTCHA restrictions, daily cap, screenshots and observed confirmation remain mandatory.

## Windows login task

The login workflow uses only the existing `discover` and `review` commands. It never calls `start-search`, `apply` or `batch`, and strips inherited submission flags.

```powershell
# Preview registration:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Register-JobAgentTask.ps1 -WhatIf
# Register at this user's login:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Register-JobAgentTask.ps1
# Inspect state/action/last result:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Get-JobAgentTask.ps1
# Test the launcher directly:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-JobAgentTask.ps1
# Test the registered task asynchronously:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-JobAgentTask.ps1 -Scheduled
# Remove the task, retaining all data:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Remove-JobAgentTask.ps1
```

The task uses the current interactive user with limited privileges, hidden execution, absolute Node/launcher paths and the project working directory. No password is stored; existing tasks are not overwritten. Re-register after moving the project or Node installation. Execution-policy flags affect only the invoked process, not machine policy.

`config/scheduler.json` sets the allowlisted workflow, per-command timeout and daily launcher run limit. The run limit is currently **0 (unlimited for testing)**; set it to 1–10 to enforce a cap. A started workflow consumes a slot even on failure, and counters reset on the next Chicago day. This is separate from the ten-application cap.

The launcher skips if any confirmed submission is already recorded today, rechecking between stages. Legacy records use their stored attempt day for that guard; untracked external applications are unknown. Task Scheduler's IgnoreNew policy and an exclusive file handle prevent overlapping launches. Corrupt state/database checks fail closed. Atomic run state lives in `data/scheduler/state.json`; retaining `launcher.lock` after a crash is harmless because the handle is the lock. Command timeouts stop the child process tree. Review continues after source failures, with partial outcomes treated as warnings as described above.

Logs: `data/scheduler/logs/launcher.jsonl` and per-stage stdout/stderr files. The latest structured run outcome is `data/scheduler/latest-run.json`. Scripts do not register tasks automatically or enable submissions.

## Install and validate (PowerShell)

Node 24+ is required for native TypeScript and `node:sqlite`. Use `.cmd` shims if PowerShell blocks npm scripts.

```powershell
npm.cmd install
npm.cmd run build
npm.cmd test
# Native Node alternative if tsx encounters a Windows userInfo error:
node --test test/*.test.ts
# Local browser fixture dry-run, zero form submissions:
node src/demo.ts
```

For first-time browser setup:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.browsers"
npx.cmd playwright install chromium
```

Set that variable again in later shells if the browser was installed there. Manual login can use `node src/cli.ts login 'https://EMPLOYER_LOGIN_URL'`; no passwords are collected in source. Cookies/session files are private under `data/browser`. Protect that directory, resumes, screenshots and profile files; they are ignored by Git. Example configurations remain available for fresh profiles, but do not overwrite your existing approved profile.

Validation: build and deterministic tests cover source 404 isolation, all-source failure, successful retry, partial pagination, credential-free adapter payloads, US eligibility, attribution, caching/robots rules, cross-provider aliases and historical submission safety, launcher warning outcomes, and existing browser form/confirmation safeguards. Every browser submission in tests is to a localhost fixture.

The latest actual discovery attempt in this restricted agent session failed with network `EACCES` before allowed API access could be established. It fetched **zero new jobs**, which is not evidence of zero available jobs. All 98 previously stored unique jobs were retained. Active-source failures were Remote OK (1), Greenhouse (16), Lever (3) and Ashby (15); optional Arbeitnow, Bosch/SmartRecruiters and retired Netflix were skipped. Run the exact discover/review commands at the top in your normal PowerShell session to obtain live matching counts; inspect `data/discovery/sources.csv` for every source's count and error. No employer applications were submitted during this work.
