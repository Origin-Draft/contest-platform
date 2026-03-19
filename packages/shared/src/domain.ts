import { z } from 'zod';

export const contestStageSchema = z.enum([
  'draft',
  'published',
  'submission-open',
  'submission-closed',
  'judging',
  'finalized',
  'announced',
]);

export const contestRoleSchema = z.enum([
  'platform-admin',
  'organizer',
  'judge',
  'entrant',
  'public',
]);

export const aiDisclosureModeSchema = z.enum([
  'required',
  'optional',
  'contest-defined',
]);

export const submissionArtifactTypeSchema = z.enum([
  'scene-card-file',
  'prompt-log',
  'source-export',
  'supporting-note',
  'screenshot',
  'other',
]);

export const submissionArtifactTypes = submissionArtifactTypeSchema.options;

export const contestSubmissionPolicySettingsSchema = z.object({
  minWords: z.number().int().positive(),
  requireSceneCards: z.boolean(),
  requireReproductionSteps: z.boolean(),
  requirePromptHistory: z.boolean(),
  allowPublicReadingOptIn: z.boolean(),
  maxSubmissionsPerEntrant: z.number().int().positive(),
  maxSubmissionsPerTeam: z.number().int().positive(),
  maxArtifactsPerSubmission: z.number().int().positive(),
  allowedArtifactTypes: z.array(submissionArtifactTypeSchema).min(1),
  judgeCanViewAuthorIdentity: z.boolean(),
  judgeCanViewAiDisclosure: z.boolean(),
  judgeCanViewProvenance: z.boolean(),
  judgeCanViewArtifacts: z.boolean(),
});

export const contestSubmissionPolicySchema = contestSubmissionPolicySettingsSchema.extend({
  cedarPolicy: z.string().min(1),
});

export type ContestSubmissionPolicySettings = z.infer<typeof contestSubmissionPolicySettingsSchema>;

const defaultContestSubmissionPolicySettings: ContestSubmissionPolicySettings = {
  minWords: 250,
  requireSceneCards: true,
  requireReproductionSteps: true,
  requirePromptHistory: true,
  allowPublicReadingOptIn: true,
  maxSubmissionsPerEntrant: 3,
  maxSubmissionsPerTeam: 2,
  maxArtifactsPerSubmission: 8,
  allowedArtifactTypes: ['scene-card-file', 'prompt-log', 'source-export', 'supporting-note', 'screenshot', 'other'],
  judgeCanViewAuthorIdentity: false,
  judgeCanViewAiDisclosure: false,
  judgeCanViewProvenance: false,
  judgeCanViewArtifacts: false,
};

export function buildContestSubmissionPolicyCedar(
  settings: ContestSubmissionPolicySettings,
): string {
  return `permit (
  principal,
  action == ContestPlatform::Action::"CreateSubmission",
  resource
)
when {
  context.wordCount >= resource.minWords &&
  context.wordCount <= resource.maxWords &&
  context.submissionsByEntrant < resource.maxSubmissionsPerEntrant &&
  (!context.isTeamSubmission || context.submissionsByTeam < resource.maxSubmissionsPerTeam) &&
  (!resource.requireSceneCards || context.hasSceneCards) &&
  (!resource.requireReproductionSteps || context.hasReproductionSteps) &&
  (!resource.requirePromptHistory || context.hasPromptHistory) &&
  (resource.allowPublicReadingOptIn || !context.allowPublicReading)
};

permit (
  principal,
  action == ContestPlatform::Action::"UploadArtifact",
  resource
)
when {
  resource.allowedArtifactTypes.contains(context.artifactType) &&
  context.currentArtifactCount < resource.maxArtifactsPerSubmission
};

permit (
  principal in ContestPlatform::Role::"judge",
  action == ContestPlatform::Action::"ViewSubmissionSection",
  resource
)
when {
  (context.section == "author-identity" && resource.judgeCanViewAuthorIdentity) ||
  (context.section == "ai-disclosure" && resource.judgeCanViewAiDisclosure) ||
  (context.section == "provenance" && resource.judgeCanViewProvenance) ||
  (context.section == "artifacts" && resource.judgeCanViewArtifacts)
};`;
}

export function normalizeContestSubmissionPolicy(
  policy?: Partial<z.infer<typeof contestSubmissionPolicySchema>> | null,
): z.infer<typeof contestSubmissionPolicySchema> {
  const mergedSettings: ContestSubmissionPolicySettings = {
    ...defaultContestSubmissionPolicySettings,
    ...policy,
    allowedArtifactTypes:
      policy?.allowedArtifactTypes && policy.allowedArtifactTypes.length > 0
        ? policy.allowedArtifactTypes
        : defaultContestSubmissionPolicySettings.allowedArtifactTypes,
  };

  return {
    ...mergedSettings,
    cedarPolicy:
      typeof policy?.cedarPolicy === 'string' && policy.cedarPolicy.trim().length > 0
        ? policy.cedarPolicy
        : buildContestSubmissionPolicyCedar(mergedSettings),
  };
}

export const defaultContestSubmissionPolicy = normalizeContestSubmissionPolicy();

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().positive(),
  captainName: z.string(),
});

export const rubricDimensionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  weight: z.number().positive(),
});

export const contestSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  tagline: z.string(),
  stage: contestStageSchema,
  opensAt: z.string(),
  closesAt: z.string(),
  maxWords: z.number().int().positive(),
  allowsTeams: z.boolean(),
  aiDisclosureMode: aiDisclosureModeSchema,
  categories: z.array(z.string()).min(1),
  judgingFocus: z.array(z.string()).min(1),
  submissionPolicy: contestSubmissionPolicySchema,
});

export const contestCreateInputSchema = z.object({
  slug: z.string().min(3),
  title: z.string().min(3),
  tagline: z.string().min(10),
  stage: contestStageSchema.default('draft'),
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  maxWords: z.number().int().positive(),
  allowsTeams: z.boolean(),
  aiDisclosureMode: aiDisclosureModeSchema,
  categories: z.array(z.string().min(1)).min(1),
  judgingFocus: z.array(z.string().min(1)).min(1),
  submissionPolicy: contestSubmissionPolicySchema,
});

export const contestUpdateInputSchema = contestCreateInputSchema.partial();

export const submissionStatusSchema = z.enum([
  'draft',
  'submitted',
  'under-review',
  'finalist',
  'winner',
  'withdrawn',
]);

export const entrySummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  contestId: z.string(),
  teamId: z.string().nullable(),
  authors: z.array(z.string()).min(1),
  status: submissionStatusSchema,
  wordCount: z.number().int().nonnegative(),
  aiStatement: z.string(),
  manuscriptText: z.string(),
});

export const submissionProvenanceSchema = z.object({
  sceneCardsText: z.string(),
  reproductionStepsText: z.string(),
  promptHistoryText: z.string(),
});

export const submissionConsentSchema = z.object({
  allowResearchUse: z.boolean(),
  allowTrainingUse: z.boolean(),
  requireAnonymization: z.boolean(),
  allowPublicReading: z.boolean(),
  agreedAt: z.string(),
});

export const submissionArtifactSchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  artifactType: submissionArtifactTypeSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string(),
});

export const submissionCreateInputSchema = z.object({
  title: z.string().min(3),
  contestId: z.string().min(3),
  teamId: z.string().nullable(),
  authors: z.array(z.string().min(1)).min(1),
  wordCount: z.number().int().positive(),
  aiStatement: z.string().min(10),
  manuscriptText: z.string().min(50),
  provenance: submissionProvenanceSchema,
  consent: submissionConsentSchema.extend({
    agreedAt: z.string().datetime(),
  }),
  status: submissionStatusSchema.default('draft'),
});

export const judgingAssignmentStatusSchema = z.enum([
  'assigned',
  'in-review',
  'completed',
]);

export const scorecardDimensionInputSchema = z.object({
  dimensionId: z.string().min(1),
  score: z.number().min(1).max(10),
  comment: z.string().min(3),
});

export const judgingAssignmentSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  entryId: z.string(),
  entryTitle: z.string(),
  status: judgingAssignmentStatusSchema,
  assignedJudge: z.string(),
  assignedJudgeUserId: z.string().nullable(),
  assignedAt: z.string(),
  submittedAt: z.string().nullable(),
  recommendation: z.enum(['advance', 'hold', 'decline']).nullable(),
  overallComment: z.string().nullable(),
  scores: z.array(scorecardDimensionInputSchema),
});

export const judgingAssignmentCreateInputSchema = z.object({
  contestId: z.string().min(1),
  entryId: z.string().min(1),
  assignedJudge: z.string().min(1),
  assignedJudgeUserId: z.string().min(1).optional(),
});

export const scorecardSubmitInputSchema = z.object({
  assignmentId: z.string().min(1),
  recommendation: z.enum(['advance', 'hold', 'decline']),
  overallComment: z.string().min(10),
  scores: z.array(scorecardDimensionInputSchema).min(1),
});

export const resultPlacementSchema = z.enum(['finalist', 'winner']);

export const entryDetailSchema = z.object({
  entry: entrySummarySchema,
  contest: contestSummarySchema,
  assignments: z.array(judgingAssignmentSchema),
  provenance: submissionProvenanceSchema,
  consent: submissionConsentSchema,
  artifacts: z.array(submissionArtifactSchema),
  access: z.object({
    canViewAuthorIdentity: z.boolean(),
    canViewAiDisclosure: z.boolean(),
    canViewProvenance: z.boolean(),
    canViewArtifacts: z.boolean(),
  }),
});

export const publicReadingEntrySchema = z.object({
  entryId: z.string(),
  title: z.string(),
  authors: z.array(z.string()).min(1),
  contestId: z.string(),
  contestTitle: z.string(),
  placement: resultPlacementSchema,
  aiStatement: z.string(),
  manuscriptText: z.string(),
  consent: submissionConsentSchema,
});

export const resultSelectionInputSchema = z.object({
  status: submissionStatusSchema.refine(
    (value) => ['submitted', 'under-review', 'finalist', 'winner'].includes(value),
    'Result status must be submitted, under-review, finalist, or winner.',
  ),
});

export const publishedResultEntrySchema = z.object({
  entryId: z.string(),
  title: z.string(),
  contestId: z.string(),
  contestTitle: z.string(),
  placement: resultPlacementSchema,
  authors: z.array(z.string()).min(1),
  teamId: z.string().nullable(),
});

export const contestResultsSchema = z.object({
  contest: contestSummarySchema,
  winners: z.array(publishedResultEntrySchema),
  finalists: z.array(publishedResultEntrySchema),
});

export const recommendationTallySchema = z.object({
  advance: z.number().int().nonnegative(),
  hold: z.number().int().nonnegative(),
  decline: z.number().int().nonnegative(),
});

export const contestScoreSummaryEntrySchema = z.object({
  entryId: z.string(),
  contestId: z.string(),
  title: z.string(),
  authors: z.array(z.string()).min(1),
  status: submissionStatusSchema,
  reviewCount: z.number().int().nonnegative(),
  averageScore: z.number().nonnegative(),
  rank: z.number().int().positive().nullable(),
  recommendations: recommendationTallySchema,
});

export const contestScoreboardSchema = z.object({
  contest: contestSummarySchema,
  entries: z.array(contestScoreSummaryEntrySchema),
});

export type ContestStage = z.infer<typeof contestStageSchema>;
export type ContestRole = z.infer<typeof contestRoleSchema>;
export type AiDisclosureMode = z.infer<typeof aiDisclosureModeSchema>;
export type ContestSubmissionPolicy = z.infer<typeof contestSubmissionPolicySchema>;
export type Team = z.infer<typeof teamSchema>;
export type RubricDimension = z.infer<typeof rubricDimensionSchema>;
export type ContestSummary = z.infer<typeof contestSummarySchema>;
export type ContestCreateInput = z.infer<typeof contestCreateInputSchema>;
export type ContestUpdateInput = z.infer<typeof contestUpdateInputSchema>;
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;
export type EntrySummary = z.infer<typeof entrySummarySchema>;
export type SubmissionProvenance = z.infer<typeof submissionProvenanceSchema>;
export type SubmissionConsent = z.infer<typeof submissionConsentSchema>;
export type SubmissionArtifactType = z.infer<typeof submissionArtifactTypeSchema>;
export type SubmissionArtifact = z.infer<typeof submissionArtifactSchema>;
export type EntryDetail = z.infer<typeof entryDetailSchema>;
export type SubmissionCreateInput = z.infer<typeof submissionCreateInputSchema>;
export type JudgingAssignmentStatus = z.infer<typeof judgingAssignmentStatusSchema>;
export type ScorecardDimensionInput = z.infer<typeof scorecardDimensionInputSchema>;
export type JudgingAssignment = z.infer<typeof judgingAssignmentSchema>;
export type JudgingAssignmentCreateInput = z.infer<typeof judgingAssignmentCreateInputSchema>;
export type ScorecardSubmitInput = z.infer<typeof scorecardSubmitInputSchema>;
export type ResultPlacement = z.infer<typeof resultPlacementSchema>;
export type ResultSelectionInput = z.infer<typeof resultSelectionInputSchema>;
export type PublishedResultEntry = z.infer<typeof publishedResultEntrySchema>;
export type ContestResults = z.infer<typeof contestResultsSchema>;
export type PublicReadingEntry = z.infer<typeof publicReadingEntrySchema>;
export type RecommendationTally = z.infer<typeof recommendationTallySchema>;
export type ContestScoreSummaryEntry = z.infer<typeof contestScoreSummaryEntrySchema>;
export type ContestScoreboard = z.infer<typeof contestScoreboardSchema>;
export type DemoSubmissionSeed = EntrySummary & {
  submittedByUserId: string;
  submittedByDisplayName: string;
  provenance: SubmissionProvenance;
  consent: SubmissionConsent;
};

export const demoContestSummaries: ContestSummary[] = [
  {
    id: 'contest-neon-ink',
    slug: 'neon-ink-spring-2026',
    title: 'Neon Ink Spring 2026',
    tagline: 'Near-future fiction where AI is part of the creative premise, not a footnote.',
    stage: 'submission-open',
    opensAt: '2026-03-20T00:00:00.000Z',
    closesAt: '2026-05-01T23:59:59.000Z',
    maxWords: 6000,
    allowsTeams: true,
    aiDisclosureMode: 'contest-defined',
    categories: ['speculative', 'literary', 'hybrid'],
    judgingFocus: ['voice', 'originality', 'human-ai collaboration clarity'],
    submissionPolicy: normalizeContestSubmissionPolicy({
      requireSceneCards: true,
      requireReproductionSteps: true,
      requirePromptHistory: true,
      allowPublicReadingOptIn: true,
      allowedArtifactTypes: ['scene-card-file', 'prompt-log', 'source-export', 'supporting-note', 'screenshot'],
      judgeCanViewAuthorIdentity: false,
      judgeCanViewAiDisclosure: true,
      judgeCanViewProvenance: false,
      judgeCanViewArtifacts: false,
    }),
  },
  {
    id: 'contest-ghost-light',
    slug: 'ghost-light-flash-open',
    title: 'Ghost Light Flash Open',
    tagline: 'Flash fiction for haunted systems, weird interfaces, and brave little sentences.',
    stage: 'published',
    opensAt: '2026-04-15T00:00:00.000Z',
    closesAt: '2026-05-15T23:59:59.000Z',
    maxWords: 1200,
    allowsTeams: false,
    aiDisclosureMode: 'required',
    categories: ['flash', 'horror', 'experimental'],
    judgingFocus: ['compression', 'ending', 'atmosphere'],
    submissionPolicy: normalizeContestSubmissionPolicy({
      requireSceneCards: false,
      requireReproductionSteps: true,
      requirePromptHistory: false,
      allowPublicReadingOptIn: false,
      allowedArtifactTypes: ['source-export', 'supporting-note', 'other'],
      judgeCanViewAuthorIdentity: false,
      judgeCanViewAiDisclosure: false,
      judgeCanViewProvenance: false,
      judgeCanViewArtifacts: false,
    }),
  },
];

export const demoTeams: Team[] = [
  {
    id: 'team-midnight-oil',
    name: 'Midnight Oil Writers Room',
    memberCount: 3,
    captainName: 'Ari Vale',
  },
];

export const demoEntries: DemoSubmissionSeed[] = [
  {
    id: 'entry-001',
    title: 'The Last Warm Compiler',
    contestId: 'contest-neon-ink',
    teamId: 'team-midnight-oil',
    submittedByUserId: 'dev-Entrant User',
    submittedByDisplayName: 'Entrant User',
    authors: ['Ari Vale', 'Sam Osei', 'Jun Park'],
    status: 'draft',
    wordCount: 4380,
    aiStatement: 'Contest-specific disclosure pending final submission.',
    manuscriptText:
      'The compiler still remembered summer. In the server room, its fans dragged warm air over Ari\'s wrists while the model suggested endings no human on the team would keep. Jun killed three perfect sentences before breakfast. Sam insisted that was how the piece learned its shape.\n\nBy dawn, the story had become less about prediction than refusal: a machine trained to finish every line meeting a crew of writers who kept choosing the stranger turn. The final paragraph arrived only after they stopped asking what the system expected and asked what grief sounded like when rendered in neon, dust, and syntax.',
      provenance: {
        sceneCardsText: 'Scene 1: Ari reviews unstable compiler output. Scene 2: team debate over what to keep. Scene 3: final paragraph emerges from deliberate refusal of predictive closure.',
        reproductionStepsText: '1. Draft premise and emotional target. 2. Use AI to generate structural alternatives. 3. Select only the turns that increase thematic pressure. 4. Rewrite prose manually. 5. Final pass for voice consistency.',
        promptHistoryText: 'Prompt batch focused on alternate scene sequencing, tonal compression, and imagery options around neon, syntax, and grief.',
      },
      consent: {
        allowResearchUse: true,
        allowTrainingUse: false,
        requireAnonymization: true,
        allowPublicReading: true,
        agreedAt: '2026-03-18T17:30:00.000Z',
      },
  },
];

export const demoJudgingAssignments: JudgingAssignment[] = [
  {
    id: 'assignment-001',
    contestId: 'contest-neon-ink',
    entryId: 'entry-001',
    entryTitle: 'The Last Warm Compiler',
    status: 'assigned',
    assignedJudge: 'Dev Judge',
    assignedJudgeUserId: null,
    assignedAt: '2026-03-25T10:00:00.000Z',
    submittedAt: null,
    recommendation: null,
    overallComment: null,
    scores: [],
  },
];

export const defaultRubric: RubricDimension[] = [
  {
    id: 'voice',
    label: 'Voice',
    description: 'Distinctiveness, precision, and tonal control.',
    weight: 0.3,
  },
  {
    id: 'structure',
    label: 'Structure',
    description: 'Clarity of movement, pacing, and payoff.',
    weight: 0.25,
  },
  {
    id: 'impact',
    label: 'Impact',
    description: 'Emotional, intellectual, or aesthetic resonance.',
    weight: 0.25,
  },
  {
    id: 'ai-craft',
    label: 'AI Craft',
    description: 'How effectively human and AI collaboration serves the final piece.',
    weight: 0.2,
  },
];
