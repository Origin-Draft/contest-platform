import type { FastifyBaseLogger } from 'fastify';
import { Pool } from 'pg';

const bootstrapSql = `
CREATE TABLE IF NOT EXISTS contests (
  id varchar(120) PRIMARY KEY,
  slug varchar(160) NOT NULL UNIQUE,
  title varchar(200) NOT NULL,
  tagline text NOT NULL,
  stage varchar(40) NOT NULL,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  max_words integer NOT NULL,
  allows_teams boolean NOT NULL,
  ai_disclosure_mode varchar(40) NOT NULL,
  categories jsonb NOT NULL,
  judging_focus jsonb NOT NULL,
  submission_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contests
  ADD COLUMN IF NOT EXISTS submission_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS teams (
  id varchar(120) PRIMARY KEY,
  name varchar(200) NOT NULL,
  member_count integer NOT NULL,
  captain_name varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id varchar(120) PRIMARY KEY,
  contest_id varchar(120) NOT NULL REFERENCES contests(id),
  team_id varchar(120) REFERENCES teams(id),
  submitted_by_user_id varchar(160) NOT NULL DEFAULT 'unknown-submitter',
  submitted_by_display_name varchar(200) NOT NULL DEFAULT 'Unknown submitter',
  title varchar(200) NOT NULL,
  authors jsonb NOT NULL,
  status varchar(40) NOT NULL,
  word_count integer NOT NULL,
  ai_statement text NOT NULL,
  manuscript_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS manuscript_text text NOT NULL DEFAULT '';

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS submitted_by_user_id varchar(160) NOT NULL DEFAULT 'unknown-submitter';

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS submitted_by_display_name varchar(200) NOT NULL DEFAULT 'Unknown submitter';

CREATE TABLE IF NOT EXISTS judge_assignments (
  id varchar(120) PRIMARY KEY,
  contest_id varchar(120) NOT NULL REFERENCES contests(id),
  entry_id varchar(120) NOT NULL REFERENCES entries(id),
  entry_title varchar(200) NOT NULL,
  status varchar(40) NOT NULL,
  assigned_judge varchar(200) NOT NULL,
  assigned_judge_user_id varchar(160),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  recommendation varchar(40),
  overall_comment text,
  scores jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE judge_assignments
  ADD COLUMN IF NOT EXISTS assigned_judge_user_id varchar(160);

CREATE TABLE IF NOT EXISTS submission_provenance (
  submission_id varchar(120) PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  scene_cards_text text NOT NULL DEFAULT '',
  reproduction_steps_text text NOT NULL DEFAULT '',
  prompt_history_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submission_consents (
  submission_id varchar(120) PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  allow_research_use boolean NOT NULL DEFAULT false,
  allow_training_use boolean NOT NULL DEFAULT false,
  require_anonymization boolean NOT NULL DEFAULT true,
  allow_public_reading boolean NOT NULL DEFAULT false,
  agreed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submission_artifacts (
  id varchar(120) PRIMARY KEY,
  submission_id varchar(120) NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  artifact_type varchar(60) NOT NULL,
  original_filename varchar(255) NOT NULL,
  storage_key varchar(255) NOT NULL,
  mime_type varchar(160) NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
`;

const seedSql = `
INSERT INTO contests (id, slug, title, tagline, stage, opens_at, closes_at, max_words, allows_teams, ai_disclosure_mode, categories, judging_focus, submission_policy)
VALUES (
  'contest-neon-ink',
  'spring-ai-writing-challenge',
  'Spring AI Writing Challenge',
  'Short fiction exploring the boundary between human craft and machine imagination.',
  'submission-open',
  '2026-03-01T00:00:00.000Z',
  '2026-04-15T23:59:59.000Z',
  '5000',
  true,
  'contest-defined',
  '["speculative", "literary"]'::jsonb,
  '["voice", "structure", "human-ai collaboration clarity"]'::jsonb,
  '{}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  tagline = EXCLUDED.tagline,
  closes_at = EXCLUDED.closes_at;

INSERT INTO contests (id, slug, title, tagline, stage, opens_at, closes_at, max_words, allows_teams, ai_disclosure_mode, categories, judging_focus, submission_policy)
VALUES (
  'contest-first-light',
  'first-light-showcase',
  'First Light Showcase',
  'Celebrating debut voices in AI-augmented storytelling.',
  'announced',
  '2025-09-01T00:00:00.000Z',
  '2025-12-15T23:59:59.000Z',
  '3000',
  false,
  'entrant-provided',
  '["literary", "memoir"]'::jsonb,
  '["voice", "emotional impact", "originality"]'::jsonb,
  '{}'::jsonb
) ON CONFLICT (id) DO UPDATE SET stage = EXCLUDED.stage;

INSERT INTO entries (id, contest_id, title, authors, status, word_count, ai_statement, manuscript_text, submitted_by_user_id, submitted_by_display_name)
VALUES (
  'entry-fl-001',
  'contest-first-light',
  'The Weight of Small Echoes',
  '["Mira Solis"]'::jsonb,
  'winner',
  2800,
  'AI was used for structural brainstorming. All prose is original.',
  'The first echo arrived on a Tuesday, thin as a whisper pressed between pages of a book nobody reads anymore.',
  'seed-user-1',
  'Mira Solis'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO entries (id, contest_id, title, authors, status, word_count, ai_statement, manuscript_text, submitted_by_user_id, submitted_by_display_name)
VALUES (
  'entry-fl-002',
  'contest-first-light',
  'Cartography of Selves',
  '["Aiden Ko", "Priya Nair"]'::jsonb,
  'finalist',
  2400,
  'Co-written with GPT-4 for ideation, all final editorial choices were human.',
  'We started mapping ourselves the way you map a country you have never visited.',
  'seed-user-2',
  'Aiden Ko'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO entries (id, contest_id, title, authors, status, word_count, ai_statement, manuscript_text, submitted_by_user_id, submitted_by_display_name)
VALUES (
  'entry-fl-003',
  'contest-first-light',
  'Rust and Remembering',
  '["Casey Wren"]'::jsonb,
  'finalist',
  2950,
  'Used AI for dialogue alternatives, kept the version closest to the character voice I wanted.',
  'The machine shop smelled the way grief tastes — metallic, lingering, impossible to wash from your hands.',
  'seed-user-3',
  'Casey Wren'
) ON CONFLICT (id) DO NOTHING;
`;

export interface DatabaseClient {
  pool: Pool;
  close(): Promise<void>;
}

export interface DatabaseClientOptions {
  allowFallback?: boolean;
  ssl?: boolean;
  /** When true, inserts demo seed data. Never set in production. */
  devSeed?: boolean;
}

export async function createDatabaseClient(
  databaseUrl: string,
  logger: FastifyBaseLogger,
  options: DatabaseClientOptions = {},
): Promise<DatabaseClient | null> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    ...(options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  try {
    await pool.query('SELECT 1');
    await pool.query(bootstrapSql);
    if (options.devSeed) {
      await pool.query(seedSql);
    }

    logger.info('Postgres connection established and schema ensured');

    return {
      pool,
      async close() {
        await pool.end();
      },
    };
  } catch (error) {
    if (!options.allowFallback) {
      logger.error({ error }, 'Postgres unavailable; refusing to boot without the configured database');
      await pool.end().catch(() => undefined);
      throw error instanceof Error
        ? error
        : new Error('Postgres unavailable; refusing to boot without the configured database');
    }

    logger.warn({ error }, 'Postgres unavailable; falling back to in-memory store');
    await pool.end().catch(() => undefined);
    return null;
  }
}