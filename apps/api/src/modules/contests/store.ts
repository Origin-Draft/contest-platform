import type {
  ContestCreateInput,
  ContestResults,
  ContestScoreSummaryEntry,
  ContestScoreboard,
  ContestSubmissionPolicy,
  ContestSummary,
  ContestUpdateInput,
  EntryDetail,
  EntrySummary,
  JudgingAssignment,
  JudgingAssignmentCreateInput,
  PublishedResultEntry,
  PublicReadingEntry,
  RecommendationTally,
  ResultSelectionInput,
  RubricDimension,
  ScorecardSubmitInput,
  SubmissionArtifact,
  SubmissionArtifactType,
  SubmissionConsent,
  SubmissionCreateInput,
  SubmissionProvenance,
  Team,
} from '@origin-draft/shared';
import type { SessionUser } from '../../auth.js';
import type { Pool } from 'pg';
import {
  contestCreateInputSchema,
  contestUpdateInputSchema,
  defaultRubric,
  demoContestSummaries,
  demoEntries,
  demoJudgingAssignments,
  demoTeams,
  judgingAssignmentCreateInputSchema,
  normalizeContestSubmissionPolicy,
  resultSelectionInputSchema,
  scorecardSubmitInputSchema,
  submissionCreateInputSchema,
} from '@origin-draft/shared';
import type {
  EntryRecord,
  JudgeAssignmentRecord,
  SubmissionArtifactRecord,
  SubmissionConsentRecord,
  SubmissionProvenanceRecord,
  TeamRecord,
} from '../../db/schema.js';

export interface OrganizerDashboard {
  stats: {
    contests: number;
    teams: number;
    submissions: number;
    judgingAssignments: number;
  };
  upcomingMilestones: Array<{
    contestId: string;
    title: string;
    closesAt: string;
    stage: ContestSummary['stage'];
  }>;
}

export interface ContestDetail {
  contest: ContestSummary;
  rubric: RubricDimension[];
  relatedEntries: EntrySummary[];
}

export interface ContestListOptions {
  includeDrafts?: boolean;
}

export interface SubmissionCreationStats {
  submissionsByEntrant: number;
  submissionsByTeam: number;
}

export interface ContestStore {
  listContests(options?: ContestListOptions): Promise<ContestSummary[]>;
  getContest(contestId: string, options?: ContestListOptions): Promise<ContestDetail | null>;
  getEntry(entryId: string): Promise<EntryDetail | null>;
  getPublicEntry(entryId: string): Promise<PublicReadingEntry | null>;
  createSubmissionArtifact(input: {
    submissionId: string;
    artifactType: SubmissionArtifactType;
    originalFilename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<SubmissionArtifact>;
  getSubmissionArtifact(artifactId: string): Promise<(SubmissionArtifact & { storageKey: string }) | null>;
  createContest(input: ContestCreateInput): Promise<ContestSummary>;
  updateContest(contestId: string, input: ContestUpdateInput): Promise<ContestSummary | null>;
  listEntries(): Promise<EntrySummary[]>;
  listEntriesBySubmitter(submitterUserId: string): Promise<EntrySummary[]>;
  getSubmissionCreationStats(
    contestId: string,
    submitterUserId: string,
    teamId: string | null,
  ): Promise<SubmissionCreationStats>;
  isEntryOwnedBy(entryId: string, submitterUserId: string): Promise<boolean>;
  createEntry(input: SubmissionCreateInput, submitter: Pick<SessionUser, 'id' | 'displayName'>): Promise<EntrySummary>;
  listJudgeAssignments(judge?: { userId: string; displayName: string }): Promise<JudgingAssignment[]>;
  createJudgeAssignment(input: JudgingAssignmentCreateInput): Promise<JudgingAssignment>;
  submitScorecard(input: ScorecardSubmitInput, judge?: { userId: string; displayName: string }): Promise<JudgingAssignment>;
  updateEntryStatus(entryId: string, input: ResultSelectionInput): Promise<EntrySummary | null>;
  listPublishedResults(): Promise<ContestResults[]>;
  listContestScoreboards(): Promise<ContestScoreboard[]>;
  listTeams(): Promise<Team[]>;
  getOrganizerDashboard(): Promise<OrganizerDashboard>;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateAssignmentScore(assignment: JudgingAssignment, rubric: RubricDimension[]): number {
  if (assignment.status !== 'completed' || assignment.scores.length === 0) {
    return 0;
  }

  const weightByDimension = new Map(rubric.map((dimension) => [dimension.id, dimension.weight]));
  return roundScore(
    assignment.scores.reduce((total, score) => total + score.score * (weightByDimension.get(score.dimensionId) ?? 0), 0),
  );
}

function buildRecommendationTally(assignments: JudgingAssignment[]): RecommendationTally {
  return assignments.reduce<RecommendationTally>(
    (tally, assignment) => {
      if (assignment.recommendation) {
        tally[assignment.recommendation] += 1;
      }
      return tally;
    },
    { advance: 0, hold: 0, decline: 0 },
  );
}

function buildContestScoreboard(
  contest: ContestSummary,
  entries: EntrySummary[],
  assignments: JudgingAssignment[],
  rubric: RubricDimension[],
): ContestScoreboard {
  const scoredEntries: ContestScoreSummaryEntry[] = entries.map((entry) => {
    const entryAssignments = assignments.filter(
      (assignment) => assignment.contestId === contest.id && assignment.entryId === entry.id && assignment.status === 'completed',
    );
    const assignmentScores = entryAssignments.map((assignment) => calculateAssignmentScore(assignment, rubric));
    const averageScore = assignmentScores.length > 0
      ? roundScore(assignmentScores.reduce((sum, score) => sum + score, 0) / assignmentScores.length)
      : 0;

    return {
      entryId: entry.id,
      contestId: entry.contestId,
      title: entry.title,
      authors: entry.authors,
      status: entry.status,
      reviewCount: entryAssignments.length,
      averageScore,
      rank: null,
      recommendations: buildRecommendationTally(entryAssignments),
    };
  });

  const rankedEntries = [...scoredEntries].sort((left, right) => {
    if (right.averageScore !== left.averageScore) {
      return right.averageScore - left.averageScore;
    }
    if (right.recommendations.advance !== left.recommendations.advance) {
      return right.recommendations.advance - left.recommendations.advance;
    }
    if (left.reviewCount !== right.reviewCount) {
      return right.reviewCount - left.reviewCount;
    }
    return left.title.localeCompare(right.title);
  });

  return {
    contest,
    entries: rankedEntries.map((entry, index) => ({
      ...entry,
      rank: entry.reviewCount > 0 ? index + 1 : null,
    })),
  };
}

function buildContestResults(contest: ContestSummary, entries: EntrySummary[]): ContestResults {
  const published = entries.filter((entry) => entry.status === 'winner' || entry.status === 'finalist');
  const mapResult = (entry: EntrySummary): PublishedResultEntry => ({
    entryId: entry.id,
    title: entry.title,
    contestId: entry.contestId,
    contestTitle: contest.title,
    placement: entry.status === 'winner' ? 'winner' : 'finalist',
    authors: entry.authors,
    teamId: entry.teamId,
  });

  return {
    contest,
    winners: published.filter((entry) => entry.status === 'winner').map(mapResult),
    finalists: published.filter((entry) => entry.status === 'finalist').map(mapResult),
  };
}

function filterVisibleContests(contests: ContestSummary[], options?: ContestListOptions): ContestSummary[] {
  if (options?.includeDrafts) {
    return contests;
  }

  return contests.filter((contest) => contest.stage !== 'draft');
}

class MemoryContestStore implements ContestStore {
  private readonly contests = new Map<string, ContestSummary>();
  private readonly entries: EntrySummary[];
  private readonly assignments: JudgingAssignment[];
  private readonly teams: Team[];
  private readonly rubric: RubricDimension[];
  private readonly provenance = new Map<string, SubmissionProvenance>();
  private readonly consents = new Map<string, SubmissionConsent>();
  private readonly artifacts = new Map<string, Array<SubmissionArtifact & { storageKey: string }>>();
  private readonly entryOwners = new Map<string, { userId: string; displayName: string }>();

  constructor() {
    demoContestSummaries.forEach((contest) => {
      this.contests.set(contest.id, contest);
    });
    this.entries = [...demoEntries];
    this.assignments = [...demoJudgingAssignments];
    this.teams = [...demoTeams];
    this.rubric = [...defaultRubric];
    demoEntries.forEach((entry) => {
      this.provenance.set(entry.id, entry.provenance);
      this.consents.set(entry.id, entry.consent);
      this.entryOwners.set(entry.id, {
        userId: entry.submittedByUserId,
        displayName: entry.submittedByDisplayName,
      });
    });
  }

  async listContests(options?: ContestListOptions): Promise<ContestSummary[]> {
    return filterVisibleContests(
      [...this.contests.values()].sort((left, right) => left.opensAt.localeCompare(right.opensAt)),
      options,
    );
  }

  async getContest(contestId: string, options?: ContestListOptions): Promise<ContestDetail | null> {
    const contest = this.contests.get(contestId);
    if (!contest) {
      return null;
    }

    if (!filterVisibleContests([contest], options).length) {
      return null;
    }

    return {
      contest,
      rubric: this.rubric,
      relatedEntries: this.entries.filter((entry) => entry.contestId === contest.id),
    };
  }

  async getEntry(entryId: string): Promise<EntryDetail | null> {
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      return null;
    }

    const contest = this.contests.get(entry.contestId);
    if (!contest) {
      return null;
    }

    return {
      entry,
      contest,
      assignments: this.assignments.filter((assignment) => assignment.entryId === entryId),
      provenance: this.provenance.get(entryId) ?? {
        sceneCardsText: '',
        reproductionStepsText: '',
        promptHistoryText: '',
      },
      consent: this.consents.get(entryId) ?? {
        allowResearchUse: false,
        allowTrainingUse: false,
        requireAnonymization: true,
        allowPublicReading: false,
        agreedAt: new Date().toISOString(),
      },
      artifacts: this.artifacts.get(entryId) ?? [],
      access: {
        canViewAuthorIdentity: true,
        canViewAiDisclosure: true,
        canViewProvenance: true,
        canViewArtifacts: true,
      },
    };
  }

  async getPublicEntry(entryId: string): Promise<PublicReadingEntry | null> {
    const detail = await this.getEntry(entryId);
    if (!detail) {
      return null;
    }

    const { entry, contest } = detail;
    if (
      !['finalized', 'announced'].includes(contest.stage) ||
      !['finalist', 'winner'].includes(entry.status) ||
      !detail.consent.allowPublicReading
    ) {
      return null;
    }

    return {
      entryId: entry.id,
      title: entry.title,
      authors: entry.authors,
      contestId: contest.id,
      contestTitle: contest.title,
      placement: entry.status === 'winner' ? 'winner' : 'finalist',
      aiStatement: entry.aiStatement,
      manuscriptText: entry.manuscriptText,
      consent: detail.consent,
    };
  }

  async createSubmissionArtifact(input: {
    submissionId: string;
    artifactType: SubmissionArtifactType;
    originalFilename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<SubmissionArtifact> {
    const artifact: SubmissionArtifact & { storageKey: string } = {
      id: `artifact-${Date.now()}`,
      submissionId: input.submissionId,
      artifactType: input.artifactType,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date().toISOString(),
      storageKey: input.storageKey,
    };

    const existing = this.artifacts.get(input.submissionId) ?? [];
    existing.unshift(artifact);
    this.artifacts.set(input.submissionId, existing);
    return artifact;
  }

  async getSubmissionArtifact(artifactId: string): Promise<(SubmissionArtifact & { storageKey: string }) | null> {
    for (const artifacts of this.artifacts.values()) {
      const artifact = artifacts.find((candidate) => candidate.id === artifactId);
      if (artifact) {
        return artifact;
      }
    }

    return null;
  }

  async createContest(input: ContestCreateInput): Promise<ContestSummary> {
    const parsed = contestCreateInputSchema.parse(input);
    const contest: ContestSummary = {
      id: `contest-${parsed.slug}`,
      ...parsed,
    };

    this.contests.set(contest.id, contest);
    return contest;
  }

  async updateContest(contestId: string, input: ContestUpdateInput): Promise<ContestSummary | null> {
    const existing = this.contests.get(contestId);
    if (!existing) {
      return null;
    }

    const parsed = contestUpdateInputSchema.parse(input);
    const updated: ContestSummary = {
      ...existing,
      ...parsed,
    };

    this.contests.set(contestId, updated);
    return updated;
  }

  async listEntries(): Promise<EntrySummary[]> {
    return this.entries;
  }

  async listEntriesBySubmitter(submitterUserId: string): Promise<EntrySummary[]> {
    return this.entries.filter((entry) => this.entryOwners.get(entry.id)?.userId === submitterUserId);
  }

  async getSubmissionCreationStats(
    contestId: string,
    submitterUserId: string,
    teamId: string | null,
  ): Promise<SubmissionCreationStats> {
    return {
      submissionsByEntrant: this.entries.filter(
        (entry) => entry.contestId === contestId && this.entryOwners.get(entry.id)?.userId === submitterUserId,
      ).length,
      submissionsByTeam: teamId
        ? this.entries.filter((entry) => entry.contestId === contestId && entry.teamId === teamId).length
        : 0,
    };
  }

  async isEntryOwnedBy(entryId: string, submitterUserId: string): Promise<boolean> {
    return this.entryOwners.get(entryId)?.userId === submitterUserId;
  }

  async createEntry(
    input: SubmissionCreateInput,
    submitter: Pick<SessionUser, 'id' | 'displayName'>,
  ): Promise<EntrySummary> {
    const parsed = submissionCreateInputSchema.parse(input);
    const contest = this.contests.get(parsed.contestId);
    if (!contest) {
      throw new Error(`Contest ${parsed.contestId} was not found.`);
    }

    if (!contest.allowsTeams && parsed.teamId) {
      throw new Error('This contest only accepts solo submissions.');
    }

    if (parsed.wordCount < contest.submissionPolicy.minWords) {
      throw new Error(`Submission does not meet the minimum word count of ${contest.submissionPolicy.minWords}.`);
    }

    if (parsed.wordCount > contest.maxWords) {
      throw new Error(`Submission exceeds the contest max word count of ${contest.maxWords}.`);
    }

    if (!['published', 'submission-open'].includes(contest.stage)) {
      throw new Error('This contest is not currently accepting submissions.');
    }

    const stats = await this.getSubmissionCreationStats(parsed.contestId, submitter.id, parsed.teamId);
    if (stats.submissionsByEntrant >= contest.submissionPolicy.maxSubmissionsPerEntrant) {
      throw new Error(
        `This contest allows at most ${contest.submissionPolicy.maxSubmissionsPerEntrant} submission${contest.submissionPolicy.maxSubmissionsPerEntrant === 1 ? '' : 's'} per entrant.`,
      );
    }

    if (parsed.teamId && stats.submissionsByTeam >= contest.submissionPolicy.maxSubmissionsPerTeam) {
      throw new Error(
        `This contest allows at most ${contest.submissionPolicy.maxSubmissionsPerTeam} submission${contest.submissionPolicy.maxSubmissionsPerTeam === 1 ? '' : 's'} per team.`,
      );
    }

    const entry: EntrySummary = {
      id: `entry-${this.entries.length + 1}`,
      ...parsed,
    };

    this.entries.unshift(entry);
    this.provenance.set(entry.id, parsed.provenance);
    this.consents.set(entry.id, parsed.consent);
    this.entryOwners.set(entry.id, {
      userId: submitter.id,
      displayName: submitter.displayName,
    });
    return entry;
  }

  async listTeams(): Promise<Team[]> {
    return this.teams;
  }

  async listJudgeAssignments(judge?: { userId: string; displayName: string }): Promise<JudgingAssignment[]> {
    return this.assignments.filter((assignment) => {
      if (!judge) return true;
      if (assignment.assignedJudgeUserId) return assignment.assignedJudgeUserId === judge.userId;
      return assignment.assignedJudge === judge.displayName;
    });
  }

  async createJudgeAssignment(input: JudgingAssignmentCreateInput): Promise<JudgingAssignment> {
    const parsed = judgingAssignmentCreateInputSchema.parse(input);
    const contest = this.contests.get(parsed.contestId);
    if (!contest) {
      throw new Error(`Contest ${parsed.contestId} was not found.`);
    }

    const entry = this.entries.find((candidate) => candidate.id === parsed.entryId && candidate.contestId === parsed.contestId);
    if (!entry) {
      throw new Error(`Entry ${parsed.entryId} was not found for contest ${parsed.contestId}.`);
    }

    const assignment: JudgingAssignment = {
      id: `assignment-${this.assignments.length + 1}`,
      contestId: parsed.contestId,
      entryId: parsed.entryId,
      entryTitle: entry.title,
      status: 'assigned',
      assignedJudge: parsed.assignedJudge,
      assignedJudgeUserId: parsed.assignedJudgeUserId ?? null,
      assignedAt: new Date().toISOString(),
      submittedAt: null,
      recommendation: null,
      overallComment: null,
      scores: [],
    };

    this.assignments.unshift(assignment);
    return assignment;
  }

  async submitScorecard(input: ScorecardSubmitInput, judge?: { userId: string; displayName: string }): Promise<JudgingAssignment> {
    const parsed = scorecardSubmitInputSchema.parse(input);
    const assignment = this.assignments.find((candidate) => candidate.id === parsed.assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${parsed.assignmentId} was not found.`);
    }

    if (judge && !(assignment.assignedJudgeUserId
      ? assignment.assignedJudgeUserId === judge.userId
      : assignment.assignedJudge === judge.displayName)) {
      throw new Error('This assignment is not assigned to the current judge.');
    }

    assignment.status = 'completed';
    assignment.submittedAt = new Date().toISOString();
    assignment.recommendation = parsed.recommendation;
    assignment.overallComment = parsed.overallComment;
    assignment.scores = parsed.scores;

    return assignment;
  }

  async updateEntryStatus(entryId: string, input: ResultSelectionInput): Promise<EntrySummary | null> {
    const parsed = resultSelectionInputSchema.parse(input);
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      return null;
    }

    entry.status = parsed.status;
    return entry;
  }

  async listPublishedResults(): Promise<ContestResults[]> {
    const contests = await this.listContests({ includeDrafts: true });
    return contests
      .filter((contest) => contest.stage === 'finalized' || contest.stage === 'announced')
      .map((contest) => buildContestResults(contest, this.entries.filter((entry) => entry.contestId === contest.id)))
      .filter((result) => result.winners.length > 0 || result.finalists.length > 0);
  }

  async listContestScoreboards(): Promise<ContestScoreboard[]> {
    const contests = await this.listContests({ includeDrafts: true });
    return contests.map((contest) =>
      buildContestScoreboard(
        contest,
        this.entries.filter((entry) => entry.contestId === contest.id),
        this.assignments.filter((assignment) => assignment.contestId === contest.id),
        this.rubric,
      ),
    );
  }

  async getOrganizerDashboard(): Promise<OrganizerDashboard> {
    const contests = await this.listContests({ includeDrafts: true });

    return {
      stats: {
        contests: contests.length,
        teams: this.teams.length,
        submissions: this.entries.length,
        judgingAssignments: this.assignments.length,
      },
      upcomingMilestones: contests.map((contest) => ({
        contestId: contest.id,
        title: contest.title,
        closesAt: contest.closesAt,
        stage: contest.stage,
      })),
    };
  }
}

interface ContestRow {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  stage: ContestSummary['stage'];
  opensAt: Date | string;
  closesAt: Date | string;
  maxWords: number;
  allowsTeams: boolean;
  aiDisclosureMode: ContestSummary['aiDisclosureMode'];
  categories: string[];
  judgingFocus: string[];
  submissionPolicy: Record<string, unknown> | null;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapContestRow(row: ContestRow): ContestSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    stage: row.stage,
    opensAt: toIsoString(row.opensAt),
    closesAt: toIsoString(row.closesAt),
    maxWords: row.maxWords,
    allowsTeams: row.allowsTeams,
    aiDisclosureMode: row.aiDisclosureMode,
    categories: row.categories,
    judgingFocus: row.judgingFocus,
    submissionPolicy: normalizeContestSubmissionPolicy(row.submissionPolicy as Partial<ContestSubmissionPolicy> | null),
  };
}

function mapEntryRecord(record: EntryRecord): EntrySummary {
  return {
    id: record.id,
    title: record.title,
    contestId: record.contestId,
    teamId: record.teamId,
    authors: record.authors,
    status: record.status,
    wordCount: record.wordCount,
    aiStatement: record.aiStatement,
    manuscriptText: record.manuscriptText,
  };
}

function mapTeamRecord(record: TeamRecord): Team {
  return {
    id: record.id,
    name: record.name,
    memberCount: record.memberCount,
    captainName: record.captainName,
  };
}

function mapJudgeAssignmentRecord(record: JudgeAssignmentRecord): JudgingAssignment {
  return {
    id: record.id,
    contestId: record.contestId,
    entryId: record.entryId,
    entryTitle: record.entryTitle,
    status: record.status,
    assignedJudge: record.assignedJudge,
    assignedJudgeUserId: record.assignedJudgeUserId ?? null,
    assignedAt: toIsoString(record.assignedAt),
    submittedAt: record.submittedAt ? toIsoString(record.submittedAt) : null,
    recommendation: record.recommendation,
    overallComment: record.overallComment,
    scores: record.scores,
  };
}

function mapSubmissionProvenanceRecord(record: SubmissionProvenanceRecord): SubmissionProvenance {
  return {
    sceneCardsText: record.sceneCardsText,
    reproductionStepsText: record.reproductionStepsText,
    promptHistoryText: record.promptHistoryText,
  };
}

function mapSubmissionConsentRecord(record: SubmissionConsentRecord): SubmissionConsent {
  return {
    allowResearchUse: record.allowResearchUse,
    allowTrainingUse: record.allowTrainingUse,
    requireAnonymization: record.requireAnonymization,
    allowPublicReading: record.allowPublicReading,
    agreedAt: toIsoString(record.agreedAt),
  };
}

function mapSubmissionArtifactRecord(record: SubmissionArtifactRecord): SubmissionArtifact & { storageKey: string } {
  return {
    id: record.id,
    submissionId: record.submissionId,
    artifactType: record.artifactType as SubmissionArtifactType,
    originalFilename: record.originalFilename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    uploadedAt: toIsoString(record.uploadedAt),
    storageKey: record.storageKey,
  };
}

class PostgresContestStore implements ContestStore {
  private readonly rubric: RubricDimension[];

  constructor(private readonly pool: Pool) {
    this.rubric = [...defaultRubric];
  }

  async seedDemoData(): Promise<void> {
    const { rows } = await this.pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM contests');
    const count = Number(rows[0]?.count ?? '0');
    if (count > 0) {
      return;
    }

    for (const team of demoTeams) {
      await this.pool.query(
        `INSERT INTO teams (id, name, member_count, captain_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [team.id, team.name, team.memberCount, team.captainName],
      );
    }

    for (const contest of demoContestSummaries) {
      await this.pool.query(
        `INSERT INTO contests (
          id, slug, title, tagline, stage, opens_at, closes_at, max_words, allows_teams,
          ai_disclosure_mode, categories, judging_focus, submission_policy
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)
        ON CONFLICT (id) DO NOTHING`,
        [
          contest.id,
          contest.slug,
          contest.title,
          contest.tagline,
          contest.stage,
          contest.opensAt,
          contest.closesAt,
          contest.maxWords,
          contest.allowsTeams,
          contest.aiDisclosureMode,
          JSON.stringify(contest.categories),
          JSON.stringify(contest.judgingFocus),
          JSON.stringify(contest.submissionPolicy),
        ],
      );
    }

    for (const entry of demoEntries) {
      await this.pool.query(
        `INSERT INTO entries (
          id, contest_id, team_id, submitted_by_user_id, submitted_by_display_name,
          title, authors, status, word_count, ai_statement, manuscript_text
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING`,
        [
          entry.id,
          entry.contestId,
          entry.teamId,
          entry.submittedByUserId,
          entry.submittedByDisplayName,
          entry.title,
          JSON.stringify(entry.authors),
          entry.status,
          entry.wordCount,
          entry.aiStatement,
          entry.manuscriptText,
        ],
      );

      await this.pool.query(
        `INSERT INTO submission_provenance (
          submission_id, scene_cards_text, reproduction_steps_text, prompt_history_text
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (submission_id) DO NOTHING`,
        [
          entry.id,
          entry.provenance.sceneCardsText,
          entry.provenance.reproductionStepsText,
          entry.provenance.promptHistoryText,
        ],
      );

      await this.pool.query(
        `INSERT INTO submission_consents (
          submission_id, allow_research_use, allow_training_use, require_anonymization, allow_public_reading, agreed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (submission_id) DO NOTHING`,
        [
          entry.id,
          entry.consent.allowResearchUse,
          entry.consent.allowTrainingUse,
          entry.consent.requireAnonymization,
          entry.consent.allowPublicReading,
          entry.consent.agreedAt,
        ],
      );
    }

    for (const assignment of demoJudgingAssignments) {
      await this.pool.query(
        `INSERT INTO judge_assignments (
          id, contest_id, entry_id, entry_title, status, assigned_judge, assigned_judge_user_id, assigned_at,
          submitted_at, recommendation, overall_comment, scores
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        ON CONFLICT (id) DO NOTHING`,
        [
          assignment.id,
          assignment.contestId,
          assignment.entryId,
          assignment.entryTitle,
          assignment.status,
          assignment.assignedJudge,
          assignment.assignedJudgeUserId,
          assignment.assignedAt,
          assignment.submittedAt,
          assignment.recommendation,
          assignment.overallComment,
          JSON.stringify(assignment.scores),
        ],
      );
    }
  }

  async listContests(options?: ContestListOptions): Promise<ContestSummary[]> {
    const { rows } = await this.pool.query<ContestRow>(
      `SELECT id, slug, title, tagline, stage,
              opens_at AS "opensAt",
              closes_at AS "closesAt",
              max_words AS "maxWords",
              allows_teams AS "allowsTeams",
              ai_disclosure_mode AS "aiDisclosureMode",
              categories,
              judging_focus AS "judgingFocus",
              submission_policy AS "submissionPolicy"
       FROM contests
       ORDER BY opens_at ASC`,
    );

    return filterVisibleContests(rows.map(mapContestRow), options);
  }

  async getContest(contestId: string, options?: ContestListOptions): Promise<ContestDetail | null> {
    const { rows } = await this.pool.query<ContestRow>(
      `SELECT id, slug, title, tagline, stage,
              opens_at AS "opensAt",
              closes_at AS "closesAt",
              max_words AS "maxWords",
              allows_teams AS "allowsTeams",
              ai_disclosure_mode AS "aiDisclosureMode",
              categories,
              judging_focus AS "judgingFocus",
              submission_policy AS "submissionPolicy"
       FROM contests
       WHERE id = $1`,
      [contestId],
    );

    const contest = rows[0];
    if (!contest) {
      return null;
    }

    const mappedContest = mapContestRow(contest);
    if (!filterVisibleContests([mappedContest], options).length) {
      return null;
    }

    const entryResult = await this.pool.query<EntryRecord>(
      `SELECT id,
              contest_id AS "contestId",
              team_id AS "teamId",
              submitted_by_user_id AS "submittedByUserId",
              submitted_by_display_name AS "submittedByDisplayName",
              title,
              authors,
              status,
              word_count AS "wordCount",
              ai_statement AS "aiStatement",
              manuscript_text AS "manuscriptText",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM entries
       WHERE contest_id = $1
       ORDER BY created_at ASC`,
      [contestId],
    );

    return {
      contest: mappedContest,
      rubric: this.rubric,
      relatedEntries: entryResult.rows.map(mapEntryRecord),
    };
  }

  async getEntry(entryId: string): Promise<EntryDetail | null> {
    const { rows } = await this.pool.query<EntryRecord>(
      `SELECT id,
              contest_id AS "contestId",
              team_id AS "teamId",
              submitted_by_user_id AS "submittedByUserId",
              submitted_by_display_name AS "submittedByDisplayName",
              title,
              authors,
              status,
              word_count AS "wordCount",
              ai_statement AS "aiStatement",
              manuscript_text AS "manuscriptText",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM entries
       WHERE id = $1`,
      [entryId],
    );

    const entry = rows[0];
    if (!entry) {
      return null;
    }

    const contestDetail = await this.getContest(entry.contestId);
    if (!contestDetail) {
      return null;
    }

    const [assignments, provenanceResult, consentResult, artifactResult] = await Promise.all([
      this.listJudgeAssignments(),
      this.pool.query<SubmissionProvenanceRecord>(
        `SELECT submission_id AS "submissionId",
                scene_cards_text AS "sceneCardsText",
                reproduction_steps_text AS "reproductionStepsText",
                prompt_history_text AS "promptHistoryText",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM submission_provenance
         WHERE submission_id = $1`,
        [entryId],
      ),
      this.pool.query<SubmissionConsentRecord>(
        `SELECT submission_id AS "submissionId",
                allow_research_use AS "allowResearchUse",
                allow_training_use AS "allowTrainingUse",
                require_anonymization AS "requireAnonymization",
                allow_public_reading AS "allowPublicReading",
                agreed_at AS "agreedAt",
                updated_at AS "updatedAt"
         FROM submission_consents
         WHERE submission_id = $1`,
        [entryId],
      ),
      this.pool.query<SubmissionArtifactRecord>(
        `SELECT id,
                submission_id AS "submissionId",
                artifact_type AS "artifactType",
                original_filename AS "originalFilename",
                storage_key AS "storageKey",
                mime_type AS "mimeType",
                size_bytes AS "sizeBytes",
                uploaded_at AS "uploadedAt"
         FROM submission_artifacts
         WHERE submission_id = $1
         ORDER BY uploaded_at DESC`,
        [entryId],
      ),
    ]);

    return {
      entry: mapEntryRecord(entry),
      contest: contestDetail.contest,
      assignments: assignments.filter((assignment) => assignment.entryId === entryId),
      provenance: provenanceResult.rows[0]
        ? mapSubmissionProvenanceRecord(provenanceResult.rows[0])
        : { sceneCardsText: '', reproductionStepsText: '', promptHistoryText: '' },
      consent: consentResult.rows[0]
        ? mapSubmissionConsentRecord(consentResult.rows[0])
        : {
            allowResearchUse: false,
            allowTrainingUse: false,
            requireAnonymization: true,
            allowPublicReading: false,
            agreedAt: new Date().toISOString(),
          },
      artifacts: artifactResult.rows.map(mapSubmissionArtifactRecord),
        access: {
          canViewAuthorIdentity: true,
          canViewAiDisclosure: true,
          canViewProvenance: true,
          canViewArtifacts: true,
        },
    };
  }

  async getPublicEntry(entryId: string): Promise<PublicReadingEntry | null> {
    const detail = await this.getEntry(entryId);
    if (!detail) {
      return null;
    }

    const { entry, contest } = detail;
    if (
      !['finalized', 'announced'].includes(contest.stage) ||
      !['finalist', 'winner'].includes(entry.status) ||
      !detail.consent.allowPublicReading
    ) {
      return null;
    }

    return {
      entryId: entry.id,
      title: entry.title,
      authors: entry.authors,
      contestId: contest.id,
      contestTitle: contest.title,
      placement: entry.status === 'winner' ? 'winner' : 'finalist',
      aiStatement: entry.aiStatement,
      manuscriptText: entry.manuscriptText,
      consent: detail.consent,
    };
  }

  async createSubmissionArtifact(input: {
    submissionId: string;
    artifactType: SubmissionArtifactType;
    originalFilename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<SubmissionArtifact> {
    const artifact = {
      id: `artifact-${Date.now()}`,
      submissionId: input.submissionId,
      artifactType: input.artifactType,
      originalFilename: input.originalFilename,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date().toISOString(),
    };

    await this.pool.query(
      `INSERT INTO submission_artifacts (
        id, submission_id, artifact_type, original_filename, storage_key, mime_type, size_bytes, uploaded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        artifact.id,
        artifact.submissionId,
        artifact.artifactType,
        artifact.originalFilename,
        artifact.storageKey,
        artifact.mimeType,
        artifact.sizeBytes,
        artifact.uploadedAt,
      ],
    );

    return artifact;
  }

  async getSubmissionArtifact(artifactId: string): Promise<(SubmissionArtifact & { storageKey: string }) | null> {
    const { rows } = await this.pool.query<SubmissionArtifactRecord>(
      `SELECT id,
              submission_id AS "submissionId",
              artifact_type AS "artifactType",
              original_filename AS "originalFilename",
              storage_key AS "storageKey",
              mime_type AS "mimeType",
              size_bytes AS "sizeBytes",
              uploaded_at AS "uploadedAt"
       FROM submission_artifacts
       WHERE id = $1`,
      [artifactId],
    );

    const artifact = rows[0];
    return artifact ? mapSubmissionArtifactRecord(artifact) : null;
  }

  async createContest(input: ContestCreateInput): Promise<ContestSummary> {
    const parsed = contestCreateInputSchema.parse(input);
    const contest: ContestSummary = {
      id: `contest-${parsed.slug}`,
      ...parsed,
    };

    await this.pool.query(
      `INSERT INTO contests (
        id, slug, title, tagline, stage, opens_at, closes_at, max_words, allows_teams,
        ai_disclosure_mode, categories, judging_focus, submission_policy
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)`,
      [
        contest.id,
        contest.slug,
        contest.title,
        contest.tagline,
        contest.stage,
        contest.opensAt,
        contest.closesAt,
        contest.maxWords,
        contest.allowsTeams,
        contest.aiDisclosureMode,
        JSON.stringify(contest.categories),
        JSON.stringify(contest.judgingFocus),
        JSON.stringify(contest.submissionPolicy),
      ],
    );

    return contest;
  }

  async updateContest(contestId: string, input: ContestUpdateInput): Promise<ContestSummary | null> {
    const existing = await this.getContest(contestId);
    if (!existing) {
      return null;
    }

    const parsed = contestUpdateInputSchema.parse(input);
    const updated: ContestSummary = {
      ...existing.contest,
      ...parsed,
    };

    await this.pool.query(
      `UPDATE contests
       SET slug = $2,
           title = $3,
           tagline = $4,
           stage = $5,
           opens_at = $6,
           closes_at = $7,
           max_words = $8,
           allows_teams = $9,
           ai_disclosure_mode = $10,
           categories = $11::jsonb,
           judging_focus = $12::jsonb,
           submission_policy = $13::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        contestId,
        updated.slug,
        updated.title,
        updated.tagline,
        updated.stage,
        updated.opensAt,
        updated.closesAt,
        updated.maxWords,
        updated.allowsTeams,
        updated.aiDisclosureMode,
        JSON.stringify(updated.categories),
        JSON.stringify(updated.judgingFocus),
        JSON.stringify(updated.submissionPolicy),
      ],
    );

    return updated;
  }

  async listEntries(): Promise<EntrySummary[]> {
    const { rows } = await this.pool.query<EntryRecord>(
      `SELECT id,
              contest_id AS "contestId",
              team_id AS "teamId",
              submitted_by_user_id AS "submittedByUserId",
              submitted_by_display_name AS "submittedByDisplayName",
              submitted_by_user_id AS "submittedByUserId",
              submitted_by_display_name AS "submittedByDisplayName",
              title,
              authors,
              status,
              word_count AS "wordCount",
              ai_statement AS "aiStatement",
              manuscript_text AS "manuscriptText",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM entries
       ORDER BY created_at DESC`,
    );

    return rows.map(mapEntryRecord);
  }

  async listEntriesBySubmitter(submitterUserId: string): Promise<EntrySummary[]> {
    const { rows } = await this.pool.query<EntryRecord>(
      `SELECT id,
              contest_id AS "contestId",
              team_id AS "teamId",
              submitted_by_user_id AS "submittedByUserId",
              submitted_by_display_name AS "submittedByDisplayName",
              title,
              authors,
              status,
              word_count AS "wordCount",
              ai_statement AS "aiStatement",
              manuscript_text AS "manuscriptText",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM entries
       WHERE submitted_by_user_id = $1
       ORDER BY created_at DESC`,
      [submitterUserId],
    );

    return rows.map(mapEntryRecord);
  }

  async getSubmissionCreationStats(
    contestId: string,
    submitterUserId: string,
    teamId: string | null,
  ): Promise<SubmissionCreationStats> {
    const [entrantCountResult, teamCountResult] = await Promise.all([
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM entries
         WHERE contest_id = $1
           AND submitted_by_user_id = $2`,
        [contestId, submitterUserId],
      ),
      teamId
        ? this.pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM entries
             WHERE contest_id = $1
               AND team_id = $2`,
            [contestId, teamId],
          )
        : Promise.resolve({ rows: [{ count: '0' }] }),
    ]);

    return {
      submissionsByEntrant: Number(entrantCountResult.rows[0]?.count ?? '0'),
      submissionsByTeam: Number(teamCountResult.rows[0]?.count ?? '0'),
    };
  }

  async isEntryOwnedBy(entryId: string, submitterUserId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ owned: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM entries
         WHERE id = $1
           AND submitted_by_user_id = $2
       ) AS owned`,
      [entryId, submitterUserId],
    );

    return rows[0]?.owned ?? false;
  }

  async createEntry(
    input: SubmissionCreateInput,
    submitter: Pick<SessionUser, 'id' | 'displayName'>,
  ): Promise<EntrySummary> {
    const parsed = submissionCreateInputSchema.parse(input);
    const contestDetail = await this.getContest(parsed.contestId, { includeDrafts: true });
    if (!contestDetail) {
      throw new Error(`Contest ${parsed.contestId} was not found.`);
    }

    const contest = contestDetail.contest;
    if (!contest.allowsTeams && parsed.teamId) {
      throw new Error('This contest only accepts solo submissions.');
    }

    if (parsed.wordCount < contest.submissionPolicy.minWords) {
      throw new Error(`Submission does not meet the minimum word count of ${contest.submissionPolicy.minWords}.`);
    }

    if (parsed.wordCount > contest.maxWords) {
      throw new Error(`Submission exceeds the contest max word count of ${contest.maxWords}.`);
    }

    if (!['published', 'submission-open'].includes(contest.stage)) {
      throw new Error('This contest is not currently accepting submissions.');
    }

    const stats = await this.getSubmissionCreationStats(parsed.contestId, submitter.id, parsed.teamId);
    if (stats.submissionsByEntrant >= contest.submissionPolicy.maxSubmissionsPerEntrant) {
      throw new Error(
        `This contest allows at most ${contest.submissionPolicy.maxSubmissionsPerEntrant} submission${contest.submissionPolicy.maxSubmissionsPerEntrant === 1 ? '' : 's'} per entrant.`,
      );
    }

    if (parsed.teamId && stats.submissionsByTeam >= contest.submissionPolicy.maxSubmissionsPerTeam) {
      throw new Error(
        `This contest allows at most ${contest.submissionPolicy.maxSubmissionsPerTeam} submission${contest.submissionPolicy.maxSubmissionsPerTeam === 1 ? '' : 's'} per team.`,
      );
    }

    const entry: EntrySummary = {
      id: `entry-${Date.now()}`,
      ...parsed,
    };

    await this.pool.query(
      `INSERT INTO entries (
        id, contest_id, team_id, submitted_by_user_id, submitted_by_display_name,
        title, authors, status, word_count, ai_statement, manuscript_text
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        entry.id,
        entry.contestId,
        entry.teamId,
        submitter.id,
        submitter.displayName,
        entry.title,
        JSON.stringify(entry.authors),
        entry.status,
        entry.wordCount,
        entry.aiStatement,
        entry.manuscriptText,
      ],
    );

    await this.pool.query(
      `INSERT INTO submission_provenance (
        submission_id, scene_cards_text, reproduction_steps_text, prompt_history_text
      )
      VALUES ($1, $2, $3, $4)`,
      [
        entry.id,
        parsed.provenance.sceneCardsText,
        parsed.provenance.reproductionStepsText,
        parsed.provenance.promptHistoryText,
      ],
    );

    await this.pool.query(
      `INSERT INTO submission_consents (
        submission_id, allow_research_use, allow_training_use, require_anonymization, allow_public_reading, agreed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.id,
        parsed.consent.allowResearchUse,
        parsed.consent.allowTrainingUse,
        parsed.consent.requireAnonymization,
        parsed.consent.allowPublicReading,
        parsed.consent.agreedAt,
      ],
    );

    return entry;
  }

  async listTeams(): Promise<Team[]> {
    const { rows } = await this.pool.query<TeamRecord>(
      `SELECT id, name,
              member_count AS "memberCount",
              captain_name AS "captainName",
              created_at AS "createdAt"
       FROM teams
       ORDER BY created_at ASC`,
    );

    return rows.map(mapTeamRecord);
  }

  async listJudgeAssignments(judge?: { userId: string; displayName: string }): Promise<JudgingAssignment[]> {
    const values: string[] = [];
    const clauses: string[] = [];

    if (judge) {
      values.push(judge.userId, judge.displayName);
      clauses.push(`(assigned_judge_user_id = $${values.length - 1} OR (assigned_judge_user_id IS NULL AND assigned_judge = $${values.length}))`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const { rows } = await this.pool.query<JudgeAssignmentRecord>(
      `SELECT id,
              contest_id AS "contestId",
              entry_id AS "entryId",
              entry_title AS "entryTitle",
              status,
              assigned_judge AS "assignedJudge",
              assigned_judge_user_id AS "assignedJudgeUserId",
              assigned_at AS "assignedAt",
              submitted_at AS "submittedAt",
              recommendation,
              overall_comment AS "overallComment",
              scores
       FROM judge_assignments
       ${whereClause}
       ORDER BY assigned_at DESC`,
      values,
    );

    return rows.map(mapJudgeAssignmentRecord);
  }

  async createJudgeAssignment(input: JudgingAssignmentCreateInput): Promise<JudgingAssignment> {
    const parsed = judgingAssignmentCreateInputSchema.parse(input);
    const contestDetail = await this.getContest(parsed.contestId, { includeDrafts: true });
    if (!contestDetail) {
      throw new Error(`Contest ${parsed.contestId} was not found.`);
    }

    const entry = contestDetail.relatedEntries.find((candidate) => candidate.id === parsed.entryId);
    if (!entry) {
      throw new Error(`Entry ${parsed.entryId} was not found for contest ${parsed.contestId}.`);
    }

    const assignment: JudgingAssignment = {
      id: `assignment-${Date.now()}`,
      contestId: parsed.contestId,
      entryId: parsed.entryId,
      entryTitle: entry.title,
      status: 'assigned',
      assignedJudge: parsed.assignedJudge,
      assignedJudgeUserId: parsed.assignedJudgeUserId ?? null,
      assignedAt: new Date().toISOString(),
      submittedAt: null,
      recommendation: null,
      overallComment: null,
      scores: [],
    };

    await this.pool.query(
      `INSERT INTO judge_assignments (
        id, contest_id, entry_id, entry_title, status, assigned_judge, assigned_judge_user_id, assigned_at,
        submitted_at, recommendation, overall_comment, scores
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        assignment.id,
        assignment.contestId,
        assignment.entryId,
        assignment.entryTitle,
        assignment.status,
        assignment.assignedJudge,
        assignment.assignedJudgeUserId,
        assignment.assignedAt,
        assignment.submittedAt,
        assignment.recommendation,
        assignment.overallComment,
        JSON.stringify(assignment.scores),
      ],
    );

    return assignment;
  }

  async submitScorecard(input: ScorecardSubmitInput, judge?: { userId: string; displayName: string }): Promise<JudgingAssignment> {
    const parsed = scorecardSubmitInputSchema.parse(input);
    const assignments = await this.listJudgeAssignments();
    const assignment = assignments.find((candidate) => candidate.id === parsed.assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${parsed.assignmentId} was not found.`);
    }

    if (judge && !(assignment.assignedJudgeUserId
      ? assignment.assignedJudgeUserId === judge.userId
      : assignment.assignedJudge === judge.displayName)) {
      throw new Error('This assignment is not assigned to the current judge.');
    }

    const updated: JudgingAssignment = {
      ...assignment,
      status: 'completed',
      submittedAt: new Date().toISOString(),
      recommendation: parsed.recommendation,
      overallComment: parsed.overallComment,
      scores: parsed.scores,
    };

    await this.pool.query(
      `UPDATE judge_assignments
       SET status = $2,
           submitted_at = $3,
           recommendation = $4,
           overall_comment = $5,
           scores = $6::jsonb
       WHERE id = $1`,
      [
        updated.id,
        updated.status,
        updated.submittedAt,
        updated.recommendation,
        updated.overallComment,
        JSON.stringify(updated.scores),
      ],
    );

    return updated;
  }

  async updateEntryStatus(entryId: string, input: ResultSelectionInput): Promise<EntrySummary | null> {
    const parsed = resultSelectionInputSchema.parse(input);

    const { rows } = await this.pool.query<EntryRecord>(
      `UPDATE entries
       SET status = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING id,
                 contest_id AS "contestId",
                 team_id AS "teamId",
             submitted_by_user_id AS "submittedByUserId",
             submitted_by_display_name AS "submittedByDisplayName",
                 title,
                 authors,
                 status,
                 word_count AS "wordCount",
                 ai_statement AS "aiStatement",
                 manuscript_text AS "manuscriptText",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [entryId, parsed.status],
    );

    const updated = rows[0];
    return updated ? mapEntryRecord(updated) : null;
  }

  async listPublishedResults(): Promise<ContestResults[]> {
    const contests = await this.listContests({ includeDrafts: true });
    const publishedContests = contests.filter((contest) => contest.stage === 'finalized' || contest.stage === 'announced');

    const results = await Promise.all(
      publishedContests.map(async (contest) => {
        const { rows } = await this.pool.query<EntryRecord>(
          `SELECT id,
                  contest_id AS "contestId",
                  team_id AS "teamId",
                  title,
                  authors,
                  status,
                  word_count AS "wordCount",
                  ai_statement AS "aiStatement",
                  manuscript_text AS "manuscriptText",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM entries
           WHERE contest_id = $1
             AND status IN ('finalist', 'winner')
           ORDER BY CASE status WHEN 'winner' THEN 0 ELSE 1 END, created_at ASC`,
          [contest.id],
        );

        return buildContestResults(contest, rows.map(mapEntryRecord));
      }),
    );

    return results.filter((result) => result.winners.length > 0 || result.finalists.length > 0);
  }

  async listContestScoreboards(): Promise<ContestScoreboard[]> {
    const contests = await this.listContests({ includeDrafts: true });
    const entries = await this.listEntries();
    const assignments = await this.listJudgeAssignments();

    return contests.map((contest) =>
      buildContestScoreboard(
        contest,
        entries.filter((entry) => entry.contestId === contest.id),
        assignments.filter((assignment) => assignment.contestId === contest.id),
        this.rubric,
      ),
    );
  }

  async getOrganizerDashboard(): Promise<OrganizerDashboard> {
    const contestListPromise: Promise<ContestSummary[]> = this.listContests({ includeDrafts: true });
    const teamListPromise: Promise<Team[]> = this.listTeams();
    const submissionCountPromise = this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM entries',
    );
    const assignmentCountPromise = this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM judge_assignments',
    );

    const [contests, teams, submissions, assignments] = await Promise.all([
      contestListPromise,
      teamListPromise,
      submissionCountPromise,
      assignmentCountPromise,
    ]);

    return {
      stats: {
        contests: contests.length,
        teams: teams.length,
        submissions: Number(submissions.rows[0]?.count ?? '0'),
        judgingAssignments: Number(assignments.rows[0]?.count ?? '0'),
      },
      upcomingMilestones: contests.map((contest) => ({
        contestId: contest.id,
        title: contest.title,
        closesAt: contest.closesAt,
        stage: contest.stage,
      })),
    };
  }
}

export async function createMemoryContestStore(): Promise<ContestStore> {
  return new MemoryContestStore();
}

export interface PostgresContestStoreOptions {
  seedDemo?: boolean;
}

export async function createPostgresContestStore(pool: Pool, options: PostgresContestStoreOptions = {}): Promise<ContestStore> {
  const store = new PostgresContestStore(pool);
  if (options.seedDemo !== false) {
    await store.seedDemoData();
  }
  return store;
}
