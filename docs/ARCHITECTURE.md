# Architecture and deliberate boundaries

## Deployable edge path

Browser keyword -> same-origin Worker -> fixed YouTube `search.list` and `videos.list` endpoints -> public metadata -> official IAB taxonomy + Jev HTTP API -> video-level result JSON. Search automatically classifies new candidates in sequence. If `fallback_required` is true, subtitle input in the video detail panel follows the existing per-segment path. Successful reclassification retains previous outputs in `previous_results`; a failure or cancellation leaves the current output unchanged.
Static HTML/CSS/ES modules and the Worker are deployed together with Workers Static Assets. No database, GPU, model weights, Node native modules or subprocesses are needed by the Worker entrypoint. Server data stays in memory; there are no transcript logs or analytics. TypeSafe receives either normalized public metadata or selected text segments. Thumbnail pixels are not fetched or analyzed.

## Local path

The Node server reuses the same Worker handler and adds a Python extraction adapter. It binds to 127.0.0.1, validates Host/Origin, bounds body sizes, and allows at most two concurrent POST handlers. Python is started with execFile arguments (no shell), a 45-second process timeout and bounded stdout. The provider API key and App token are removed from its environment. Do not expose the localhost adapter through a public tunnel.

YouTube extraction is optional and may be blocked. The cloud path intentionally does not attempt it. A local extraction JSON can be uploaded into the hosted UI; no local service URL is accepted by the Worker.

## Inference contract

Noul per subject provides multi-label decisions rather than mutually exclusive Choice probabilities. Breadth is bounded, so this is a budgeted hierarchical search, not exhaustive classification of every leaf. Parent-to-child scores are independently evaluated; minimum-path scoring is a heuristic only. Inconsistency is flagged rather than hidden. Absence of sufficient evidence and exhaustion of compute budgets are different statuses.

No vision encoder, OCR, ASR or VLM is implemented. Metadata is a fast-path estimate, not proof of video contents. The next quality study needs human-labeled videos and separate metrics for metadata-only coverage, fallback rate, hierarchical precision/recall, calibration, latency and end-to-end cost.

## Topic and purpose discovery

Selected IAB topics use configurable AND/OR matching over accepted labels and their actual ancestor IDs. Viewing-purpose selections use OR, intersected with the topic group and assessment-state filter. Counts and filters cover only collected candidates. Any active topic, purpose, or assessment-state filter pauses automatic pagination; resuming clears the filters. JSON exports retain the selected filter configuration and all collected items.

Five project-defined purposes (introduction, tutorial, product comparison, news, case study) are independent Noul questions batched with the existing sufficiency question. They are not IAB categories and are never inferred from category names. No extra purpose-only HTTP request is introduced, though token usage increases. Each assessed evidence unit stores all five raw values, accepted labels, and evidence IDs in `purpose_assessment`; top-level `purpose_rubric` records its version, threshold, and evidence scope. Classification output is schema `1.2`; collection exports are `explore-1.1`.

Insufficient evidence suppresses accepted purpose labels while retaining returned scores. Short or budget-skipped segments and legacy results remain explicitly unassessed. Purpose results obtained before a later IAB budget limit remain usable. For transcripts, the UI aggregates accepted purposes only from assessed segments, exposes each segment's scores, and leaves omitted segments unknown. The keyless demo uses explicit purpose fixtures; no live error substitutes demo data.

## Deployment threat model

There is no application-token authentication. The UI invokes inference as part of search or an explicit transcript reclassification action, sending the existing `consent: true` API field. POST handlers check Origin, Sec-Fetch-Site and JSON content type. These checks constrain browser cross-origin requests; they are not user authentication and do not prevent direct HTTP clients. Deployment access control (for example Cloudflare Access) and per-user limits are separate and have not been configured by this UI change. YouTube and TypeSafe keys remain server-side, and upstream bodies are never echoed on error. YouTube endpoints are fixed; queries and validated IDs are encoded as parameters. Defaults cap attempts, time, input size and search breadth.
