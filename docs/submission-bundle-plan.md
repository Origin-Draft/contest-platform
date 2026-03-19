# Submission Bundle Plan

## Goal

Evolve `contest-platform` from a simple manuscript submission flow into a **structured submission bundle** system that can support:

- contest judging
- entrant process transparency
- reproducible AI-assisted writing workflows
- future research and training dataset extraction

The platform should treat external sources like GitHub Gists and Google Docs as **optional import paths**, not as the canonical source of truth.

## Product decision

### Canonical submission model

Each submission should be stored as a **bundle** with two major layers:

1. **Judging artifact**
	- the manuscript that judges evaluate
2. **Process provenance**
	- supporting artifacts that explain how the text was created

This distinction allows the platform to keep judging fair while still collecting the structured process data needed for future dataset work.

## Recommended transport strategy

### Canonical ingestion methods

- paste manuscript text
- upload manuscript file
- enter structured provenance fields directly in the platform

### Optional import methods

- import from GitHub Gist URL
- import from Google Doc export or pasted text
- upload exported prompt/session transcripts

External systems should be snapshotted into platform-controlled storage during import so future access does not depend on mutable third-party URLs or permissions.

## Submission bundle structure

### 1. Manuscript

Required fields:

- title
- manuscript text or uploaded file
- word count
- contest/category metadata
- team / authorship metadata
- AI disclosure statement

### 2. Provenance packet

Structured fields and/or attachments:

- scene cards
- outline / beats / synopsis
- steps to reproduce the draft
- prompt history / chat transcript
- model and tool metadata
- human vs AI contribution notes
- revision summary
- imported source references

### 3. Attachments

Optional files:

- markdown notes
- screenshots
- prompt exports
- JSON logs
- PDFs / DOCX exports
- supporting research files if contest rules allow them

### 4. Consent and rights

Separate manuscript rights from provenance rights. A submission should record:

- permission to retain the manuscript
- permission to retain provenance artifacts
- permission to use anonymized artifacts for research/training
- permission to use non-anonymized artifacts
- public reading permission if selected as finalist/winner
- revocation / policy timestamp information

## Contest policy model

Each contest should define provenance requirements per artifact type.

### Requirement modes

- `required`
- `optional`
- `forbidden`

### Visibility modes

- `entrant-only`
- `organizer-only`
- `judge-visible`
- `public-if-selected`
- `internal-research-only`

### Recommended contest-configurable artifact types

- manuscript
- AI disclosure
- scene card
- steps to reproduce
- prompt transcript
- tool/model metadata
- revision summary
- external source link
- research/training consent

## Storage architecture

### Recommended production split

- **PostgreSQL** for metadata, policy flags, indexing, status, and consent state
- **object storage** for files and large artifacts

### Recommended object storage choice

- **Cloudflare R2** for production
- **local filesystem** for initial development
- optionally **MinIO** later if local S3-compatible parity becomes useful

This aligns with the current Cloudflare deployment direction while avoiding the complexity of introducing a second major cloud vendor too early.

## Proposed data model extensions

### `submission_artifacts`

Stores every structured file/blob attached to a submission.

Suggested fields:

- `id`
- `submission_id`
- `artifact_type`
- `storage_kind`
- `object_key`
- `original_filename`
- `mime_type`
- `size_bytes`
- `visibility_mode`
- `source_kind`
- `created_at`

### `submission_provenance`

Stores normalized process data for later training extraction.

Suggested fields:

- `submission_id`
- `scene_cards_markdown`
- `repro_steps_markdown`
- `prompt_history_text`
- `process_summary`
- `revision_summary`
- `toolchain_json`
- `human_ai_split_notes`

### `submission_consents`

Suggested fields:

- `submission_id`
- `allow_research_use`
- `allow_training_use`
- `require_anonymization`
- `allow_public_reading`
- `agreed_at`
- `policy_version`

### `external_sources`

Suggested fields:

- `submission_id`
- `source_kind`
- `source_url`
- `snapshot_object_key`
- `imported_at`
- `import_status`

## API direction

### Near-term endpoints

- `POST /api/submissions` — create submission bundle metadata
- `PATCH /api/submissions/:id` — update bundle metadata before lock/final submit
- `POST /api/submissions/:id/artifacts` — upload or register artifact metadata
- `PATCH /api/submissions/:id/provenance` — update structured provenance fields
- `PATCH /api/submissions/:id/consents` — update consent flags
- `GET /api/submissions/:id` — internal detail page
- `GET /api/public/entries/:id` — public finalist/winner reading page

### Later import endpoints

- `POST /api/submissions/:id/import/gist`
- `POST /api/submissions/:id/import/google-doc`

Imports should snapshot content into platform storage and store normalized metadata rather than depending on external documents at read time.

## UI direction

### Entrant flow

1. Create manuscript
2. Add provenance fields
3. Upload supporting artifacts
4. Set visibility/consent flags where allowed
5. Review submission bundle before final submit

### Organizer flow

- define contest-specific artifact requirements
- inspect full provenance bundle
- view consent state and training eligibility
- export approved bundles later for research/training workflows

### Judge flow

By default judges should see:

- manuscript
- basic category metadata
- AI disclosure only if contest policy allows it

Judges should **not** automatically see scene cards, prompt history, or detailed provenance unless a contest explicitly enables that.

## Implementation phases

### Phase 1 — structured provenance MVP

Add to current submission flow:

- manuscript file/text dual support
- scene card text area
- steps to reproduce text area
- prompt history text area
- consent flags

Deliverables:

- shared schemas
- Postgres columns/tables
- API endpoints
- entrant form updates
- organizer visibility on submission detail page

### Phase 2 — artifact uploads

Add:

- upload API
- local filesystem storage adapter
- artifact metadata table
- artifact listing in submission detail page

This is the right first implementation target after planning.

### Phase 3 — contest-configurable provenance requirements

Add organizer controls for:

- required vs optional provenance fields
- visibility rules
- consent requirements

### Phase 4 — importers

Add optional:

- Gist import
- Google Doc import / export ingestion

These are intentionally delayed until the canonical bundle model is already stable.

### Phase 5 — dataset extraction pipeline

Add:

- anonymization flags and export rules
- training eligibility filters
- bundle export format for research pipelines

## Recommended immediate implementation slice

The next slice to build should be:

1. add `submission_provenance` and `submission_consents`
2. extend entrant submission form with structured provenance fields
3. surface provenance on organizer/internal entry detail pages
4. add a local artifact storage adapter for uploaded files

This sequence keeps the MVP usable while moving the data model toward future training-quality bundles.

## Open questions to resolve later

- Should judges ever see scene cards or prompt logs?
- Are prompt transcripts redactable after submission lock?
- What level of anonymization is required before dataset export?
- Should public winners pages include AI disclosure by default?
- Will provenance exports be per-submission or batch-level?

## Decision summary

- **Canonical source of truth:** platform-owned submission bundle
- **External systems:** optional import only
- **Blob storage:** Cloudflare R2 in production, local filesystem in dev
- **Core objective:** preserve enough structured process data for future research/training without contaminating judging workflows
