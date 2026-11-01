# Runtime LLM agent

The repository now contains two execution paths. Existing `discover`, `review`, `apply`, `batch`, and `start-search` commands retain their deterministic behavior. New `agent-evaluate` and `agent-apply` commands call the **OpenAI Responses API through the official `openai` TypeScript SDK**. They never fall back to the deterministic demo model if credentials are missing.

## Installation and configuration

Use Node 24+ and your existing Playwright Chromium installation:

```powershell
Set-Location C:\Users\johnl\job-agent
npm.cmd install
# If completing the dependency install manually:
npm.cmd install openai pdfjs-dist
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` locally. Set `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_INPUT_USD_PER_MILLION`, and `OPENAI_OUTPUT_USD_PER_MILLION`. Model and pricing values are deliberately not hardcoded. Choose a model your account can use that supports Responses API strict function tools and structured output. Get its current standard prices from [OpenAI pricing](https://developers.openai.com/api/docs/pricing). Cached input discounts are not assumed. Keep `.env` private; it is ignored by Git. Never paste the key into profile data, a resume, a tool argument, or logs.

The app does not automatically load `.env`; use Node's explicit `--env-file=.env` switch, or set environment variables in your own shell. A local `.env` is read by Node for application configuration, not by the model or browser tools.

```powershell
# Extract and inspect evidence locally; this command does not call a model:
node --env-file=.env src/cli.ts agent-evidence
# Uses a paid model request to evaluate one discovered job:
node --env-file=.env src/cli.ts agent-evaluate 'EXACT_JOB_ID'
# Real model + real employer page, stops before final submission:
node --env-file=.env src/cli.ts agent-apply 'EXACT_JOB_ID'
# Show the persistent browser while the model works:
node --env-file=.env src/cli.ts agent-apply 'EXACT_JOB_ID' --headed
```

Discover and select a job using the existing commands first:

```powershell
node src/cli.ts discover
node src/cli.ts review
```

`agent-apply` always performs semantic evaluation before its browser loop. Ordinary discovery remains credential-free and does not spend model tokens. The Windows login task still runs discovery and review only; it does not automatically invoke the LLM or submit applications.

## Approved evidence

Only `config/profile.json`, your configured resumes within the real `resumes` directory, and the approved shared answer policy are used as fact sources. PDF text extraction uses `pdfjs-dist`; no resume upload to a hosted file API is needed. The model receives the extracted approved text plus profile facts to do its work. Optional screenshots can also contain personal information. These model requests send that information to OpenAI; `store:false` is used, but it is not a promise about all provider retention policies.

`agent-evidence` writes `data/approved-evidence.json` so you can inspect exact evidence IDs and source text before using the agent. Evidence is regenerated from the approved files for each run; webpage text cannot create new approved facts. The already approved Amazon SDE II role and DynamoDB/AWS/distributed-systems/IoT/WorkcellAI/observability background are included in the local profile without adding qualifications or metrics.

Every field answer requires `{id, quote}` references to that evidence. The executor verifies that the quoted text exists. Generated screening answers currently use **extractive composition**: exact approved quotations, or quotations joined with a space/newline. Unsupported paraphrases and additional claims are rejected rather than accepted on the model's assurance. Work authorization, sponsorship, demographics, identity and compensation questions additionally require the corresponding specific fact or an approved answer scoped to that exact control. A resume skill cannot substitute for work authorization, nor can total compensation substitute for a base-salary answer.

Unknown legal eligibility, clearance, technology-specific years, gender, disability/veteran status, or other required facts cause `needs_answers`. Optional unknown demographics should be left blank. Credentials and sensitive financial/identity identifiers are filtered from profile evidence, and protected identifier questions are unsupported. This is intentional: the LLM can choose and assemble truthful evidence, not manufacture personal history.

## Semantic evaluation

The model identifies required qualifications using literal job-description quotations, assigns supported/unknown/gap assessments with approved evidence references, and returns a structured fit score and concise explanation. The result is schema-validated and stored in `semantic_evaluations`.

Existing deterministic role, location, score and unresolved-application-URL rules remain authoritative. Disclosed salary remains distinct from total compensation; missing salary is still flagged and allowed by the existing shared policy. The LLM cannot invent equity/bonus amounts or override these rules. The semantic score threshold defaults to 50 and can be configured with `AGENT_MIN_FIT_SCORE`.

## Observe–reason–act controller

Each application runs this loop:

1. Inspect the current visible DOM: URL/title, accessible labels, control types, options, values, required/disabled state, validation messages, surrounding question text and optionally a screenshot.
2. Send the observation, approved evidence, job, mode and bounded tool definitions to the configured model.
3. Require exactly one strict function call. Validate its name, schema, current observation revision, observed control ID, evidence and policy in application code.
4. Execute the action through Playwright; observe the resulting page again before the next model decision.

The model sees opaque IDs such as `c7`, not arbitrary CSS/code entry points. Page text is explicitly untrusted. No shell, filesystem-read, browser-JavaScript, external-network or arbitrary-navigation tool exists. The executor uses only trusted, fixed DOM-inspection code.

Tools:

| Tool | Executor boundary |
|---|---|
| `inspect_page` | Inspect the current employer page |
| `fill_field` | Current observed text field; exact approved evidence |
| `choose_option` | Observed native select/ARIA combobox/checkbox/radio; approved evidence |
| `click` | Observed supported navigation button or privileged final submission |
| `upload_resume` | Existing selected resume category; no path argument; realpath/extension/size checks |
| `stop_for_missing_fact` | End with the missing required question recorded |

Client-side multi-step forms and conditional fields are observed after each action. Validation errors can be corrected by a new model decision using other approved evidence. Unsupported controls/questions stop the run. A native `type=submit` button labelled Next is treated as ambiguous and needs a verified adapter; the model cannot assume it is merely navigation.

The same-origin browser boundary permits only the employer origin, known Greenhouse aliases, and explicitly configured `AGENT_ALLOWED_ORIGINS`. CAPTCHA, access restrictions, MFA/login/password controls, unexpected popups/downloads, forbidden robots paths and unreadable robots policy stop the run. Robot crawl delay is respected. The agent does not bypass the restricted network environment in which a caller runs it.

## Submission and network safeguards

Dry-run is the default. `--dry-run` also overrides a supplied submission flag. The old single-job permit has been cleared, and `config/submission.json` is `enabled:false` with an empty permit list during development.

Both the agent browser executor and the common final-submission executor enforce authorization. The common executor performs required-field validation, checks the current employer origin, rejects pre-existing confirmation, atomically reserves the existing SQLite daily/duplicate slot, then clicks submit and requires the existing configured confirmation evidence. Only then are confirmation URL, screenshot, submission date and `submitted` stored. Errors after reservation stay uncertain and block automatic retry. Model text saying “submitted” is never sufficient.

The LLM cannot bypass the gate by calling a differently named tool. Non-read browser requests are blocked before a final submission has been authorized and reserved. Unapproved external writes are also blocked. This protects against a misleading Next button that silently POSTs an application. Some real ATS systems require draft/save/resume-upload POSTs before final submission. Those may stop under the strict default; an exact endpoint can be explicitly configured in `AGENT_ALLOWED_DRAFT_URLS` only after its non-final semantics have been independently verified. Do not whitelist final submission endpoints. Page instructions and the model cannot add this configuration. This is a supported-layout boundary, not a claim that arbitrary websites can always be automated safely.

To authorize a future real submission, deliberately configure the existing global switch and environment flag, or an exact single-job permit, then pass `--submit` / `--submit-once` to `agent-apply`. No real submission command is run in development. The ten-attempt daily cap, source restrictions, duplicate aliases, evidence checks and confirmation requirements still apply. Legacy deterministic application execution now uses the same guarded final-submission executor.

## Budgets and logs

Configuration is documented in `.env.example`:

- `AGENT_MAX_STEPS=40`, `AGENT_MAX_REPEATED_ACTIONS=2`.
- `AGENT_MAX_TOKENS=120000` counts input and output across evaluation and browser calls.
- `AGENT_MAX_USD=1` caps estimated cost using your configured model prices.
- `AGENT_MAX_OUTPUT_TOKENS=1500` bounds every model response, including reasoning/output usage reported by the provider.
- `AGENT_SCREENSHOTS=0` keeps images out of model requests by default.

Before each request, the budget reserves a conservative UTF-8-byte-based text/input bound (including tool schemas/history) plus the requested maximum output. Only a request that fits the remaining token/dollar budgets is sent. Actual reported usage then replaces the reservation. Screenshots are included in this conservative input bound and can require larger configured budgets. A failed request with unknown usage consumes its full reservation; there are no automatic SDK retries. If provider usage exceeds the reservation, the run stops before executing an action. Dollar accounting depends on accurate configured prices, uses standard input rates even for cached tokens, and is an estimate rather than an invoice or account-level spending control.

Every run writes `data/agent-runs/<run-id>/trace.jsonl`, observation JSON files and a final screenshot. SQLite `agent_runs` records status, steps, input/output tokens, estimated USD, error and trace location. Logs contain short model decision rationales, tool calls, evidence references, observed validation errors and results—not hidden chain of thought. They may contain approved personal information, so keep `data` private. The existing application reports include the latest agent status and error. Semantic assessments are available through `agent-evaluate` and the SQLite table; they do not overwrite deterministic job scores.

Terminal statuses include `dry_run_ready`, `submitted`, `needs_answers`, `blocked`, `uncertain`, `budget_exhausted`, `stalled`, and `max_steps`. A dry-run-ready result verifies the supported observed form path; it does not guarantee an employer will accept a later application.

## Test and demonstrate

```powershell
npm.cmd run build
node --test test/*.test.ts
# Explicit MOCK model + real controller/Playwright, synthetic local form, no API call:
npm.cmd run demo:agent
# Actual configured OpenAI model, synthetic local form, always dry-run:
node --env-file=.env src/agent/demo.ts --openai
```

The demo never permits a real final submission, even if the model requests one. The mock demonstration is clearly labelled; it proves the controller/executor loop, not live inference quality. The actual OpenAI demo requires your own configured credentials/model/prices. Unit/integration tests mock model output; no test sends data to OpenAI or visits employer pages. They cover unfamiliar multi-step forms, conditional fields, observed validation recovery, untrusted page instructions, forbidden tools/paths, unknown legal facts, budgets, repeated actions, dry-run network guards and confirmed localhost-only test submissions.

During implementation, outbound npm access from the assistant's execution session was denied with `EACCES`. The new dependencies are declared in `package.json`, but the successful package installation and lockfile refresh must run from the normal Windows shell. Until `openai` and `pdfjs-dist` are installed, `tsc` reports missing modules for those two packages; SDK-backed typechecking and actual PDF extraction have not been verified. The local mock-model browser loop and model-independent tests do run without them. No genuine OpenAI round trip has been claimed from this restricted session, and no real employer application was submitted.

References: [Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [function-calling loop](https://developers.openai.com/api/docs/guides/function-calling).
