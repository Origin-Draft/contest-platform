import type { AiDisclosureMode, ContestStage, SubmissionStatus } from '@origin-draft/shared';
import type { JudgingAssignmentStatus, ScorecardDimensionInput } from '@origin-draft/shared';

export interface ContestRecord {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  stage: ContestStage;
  opensAt: string;
  closesAt: string;
  maxWords: number;
  allowsTeams: boolean;
  aiDisclosureMode: AiDisclosureMode;
  categories: string[];
  judgingFocus: string[];
  submissionPolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  memberCount: number;
  captainName: string;
  createdAt: string;
}

export interface EntryRecord {
  id: string;
  contestId: string;
  teamId: string | null;
  submittedByUserId: string;
  submittedByDisplayName: string;
  title: string;
  authors: string[];
  status: SubmissionStatus;
  wordCount: number;
  aiStatement: string;
  manuscriptText: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionProvenanceRecord {
  submissionId: string;
  sceneCardsText: string;
  reproductionStepsText: string;
  promptHistoryText: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionConsentRecord {
  submissionId: string;
  allowResearchUse: boolean;
  allowTrainingUse: boolean;
  requireAnonymization: boolean;
  allowPublicReading: boolean;
  agreedAt: string;
  updatedAt: string;
}

export interface SubmissionArtifactRecord {
  id: string;
  submissionId: string;
  artifactType: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface JudgeAssignmentRecord {
  id: string;
  contestId: string;
  entryId: string;
  entryTitle: string;
  status: JudgingAssignmentStatus;
  assignedJudge: string;
  assignedJudgeUserId: string | null;
  assignedAt: string;
  submittedAt: string | null;
  recommendation: 'advance' | 'hold' | 'decline' | null;
  overallComment: string | null;
  scores: ScorecardDimensionInput[];
}

export const databaseTables = {
  contests: {
    name: 'contests',
    primaryKey: 'id',
    columns: [
      'id',
      'slug',
      'title',
      'tagline',
      'stage',
      'opensAt',
      'closesAt',
      'maxWords',
      'allowsTeams',
      'aiDisclosureMode',
      'categories',
      'judgingFocus',
      'submissionPolicy',
      'createdAt',
      'updatedAt',
    ] as const,
  },
  teams: {
    name: 'teams',
    primaryKey: 'id',
    columns: ['id', 'name', 'memberCount', 'captainName', 'createdAt'] as const,
  },
  entries: {
    name: 'entries',
    primaryKey: 'id',
    columns: [
      'id',
      'contestId',
      'teamId',
      'submittedByUserId',
      'submittedByDisplayName',
      'title',
      'authors',
      'status',
      'wordCount',
      'aiStatement',
      'manuscriptText',
      'createdAt',
      'updatedAt',
    ] as const,
  },
  judgeAssignments: {
    name: 'judge_assignments',
    primaryKey: 'id',
    columns: [
      'id',
      'contestId',
      'entryId',
      'entryTitle',
      'status',
      'assignedJudge',
      'assignedAt',
      'submittedAt',
      'recommendation',
      'overallComment',
      'scores',
    ] as const,
  },
  submissionProvenance: {
    name: 'submission_provenance',
    primaryKey: 'submissionId',
    columns: [
      'submissionId',
      'sceneCardsText',
      'reproductionStepsText',
      'promptHistoryText',
      'createdAt',
      'updatedAt',
    ] as const,
  },
  submissionConsents: {
    name: 'submission_consents',
    primaryKey: 'submissionId',
    columns: [
      'submissionId',
      'allowResearchUse',
      'allowTrainingUse',
      'requireAnonymization',
      'allowPublicReading',
      'agreedAt',
      'updatedAt',
    ] as const,
  },
  submissionArtifacts: {
    name: 'submission_artifacts',
    primaryKey: 'id',
    columns: [
      'id',
      'submissionId',
      'artifactType',
      'originalFilename',
      'storageKey',
      'mimeType',
      'sizeBytes',
      'uploadedAt',
    ] as const,
  },
} as const;
