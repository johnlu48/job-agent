# Verified employer source catalog

Verified on 2026-10-30 by opening the public employer board page and checking the employer name/title or its redirect to the employer careers site. These are observed board identifiers, not guessed API URLs. This verifies the company/board association, not an assurance that every API endpoint is currently reachable from your network. Runtime failures remain isolated and appear in data/discovery/sources.csv.

| Employer | Adapter | Board identifier | Verification evidence |
|---|---|---|---|
| Cloudflare | greenhouse | cloudflare | [Public employer board](https://job-boards.greenhouse.io/cloudflare) |
| Datadog | greenhouse | datadog | [Public employer board](https://job-boards.greenhouse.io/datadog) |
| Databricks | greenhouse | databricks | [Public employer board](https://job-boards.greenhouse.io/databricks) |
| MongoDB | greenhouse | mongodb | [Public employer board](https://job-boards.greenhouse.io/mongodb) |
| Cockroach Labs | greenhouse | cockroachlabs | [Public employer board](https://job-boards.greenhouse.io/cockroachlabs) |
| Stripe | greenhouse | stripe | [Public employer board](https://job-boards.greenhouse.io/stripe) |
| Figma | greenhouse | figma | [Public employer board](https://job-boards.greenhouse.io/figma) |
| Reddit | greenhouse | reddit | [Public employer board](https://job-boards.greenhouse.io/reddit) |
| Affirm | greenhouse | affirm | [Public employer board](https://job-boards.greenhouse.io/affirm) |
| Discord | greenhouse | discord | [Public employer board](https://job-boards.greenhouse.io/discord) |
| Roblox | greenhouse | roblox | [Public employer board](https://job-boards.greenhouse.io/roblox) |
| Anthropic | greenhouse | anthropic | [Public employer board](https://job-boards.greenhouse.io/anthropic) |
| Vercel | greenhouse | vercel | [Public employer board](https://job-boards.greenhouse.io/vercel) |
| Scale AI | greenhouse | scaleai | [Public employer board](https://job-boards.greenhouse.io/scaleai) |
| Elastic | greenhouse | elastic | [Public employer board](https://job-boards.greenhouse.io/elastic) |
| Dropbox | greenhouse | dropbox | [Public employer board](https://job-boards.greenhouse.io/dropbox) |
| Palantir | lever | palantir | [Public employer board](https://jobs.lever.co/palantir) |
| Zoox | lever | zoox | [Public employer board](https://jobs.lever.co/zoox) |
| Spotify | lever | spotify | [Public employer board](https://jobs.lever.co/spotify) |
| OpenAI | ashby | openai | [Public employer board](https://jobs.ashbyhq.com/openai) |
| Ramp | ashby | ramp | [Public employer board](https://jobs.ashbyhq.com/ramp) |
| Notion | ashby | notion | [Public employer board](https://jobs.ashbyhq.com/notion) |
| Linear | ashby | linear | [Public employer board](https://jobs.ashbyhq.com/linear) |
| Render | ashby | render | [Public employer board](https://jobs.ashbyhq.com/render) |
| Supabase | ashby | supabase | [Public employer board](https://jobs.ashbyhq.com/supabase) |
| Modal | ashby | modal | [Public employer board](https://jobs.ashbyhq.com/modal) |
| Baseten | ashby | baseten | [Public employer board](https://jobs.ashbyhq.com/baseten) |
| LangChain | ashby | langchain | [Public employer board](https://jobs.ashbyhq.com/langchain) |
| Cohere | ashby | cohere | [Public employer board](https://jobs.ashbyhq.com/cohere) |
| Vanta | ashby | vanta | [Public employer board](https://jobs.ashbyhq.com/vanta) |
| Deepgram | ashby | deepgram | [Public employer board](https://jobs.ashbyhq.com/deepgram) |
| Perplexity | ashby | perplexity | [Public employer board](https://jobs.ashbyhq.com/perplexity) |
| ElevenLabs | ashby | elevenlabs | [Public employer board](https://jobs.ashbyhq.com/elevenlabs) |
| Crusoe | ashby | crusoe | [Public employer board](https://jobs.ashbyhq.com/crusoe) |
| Bosch | smartrecruiters | BoschGroup | [Public employer board](https://careers.smartrecruiters.com/BoschGroup) |

34 Greenhouse/Lever/Ashby employers are enabled. Bosch is an optional 35th employer via the documented unauthenticated SmartRecruiters Posting API; enable it only after checking reachability locally. Board-page redirects do not guarantee that a legacy JSON API remains active. No discovered job is deleted when a board becomes unavailable.

Netflix is excluded from this verified catalog: its configured Lever endpoint was checked and returns 404. Its [official careers site](https://www.jobs.netflix.com/) links to [this current portal](https://explore.jobs.netflix.net/careers). The old source remains disabled with that explanation. No replacement API was invented.

PostHog and Confluent were not added: the attempted portal verifications did not establish currently usable board identifiers.

Public references: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board), [Lever Postings API](https://github.com/lever/postings-api), [Ashby public postings](https://developers.ashbyhq.com/docs/public-job-posting-api), [SmartRecruiters authentication](https://developers.smartrecruiters.com/docs/authentication), [SmartRecruiters endpoints](https://developers.smartrecruiters.com/docs/endpoints).
