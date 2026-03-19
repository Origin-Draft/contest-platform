import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import type {
  ContestSubmissionPolicy,
  ContestSummary,
  EntryDetail,
  SubmissionArtifactType,
  SubmissionCreateInput,
} from '@origin-draft/shared';
import type { SessionUser } from '../../auth.js';

const userEntityType = 'ContestPlatform::User';
const roleEntityType = 'ContestPlatform::Role';
const contestEntityType = 'ContestPlatform::Contest';
const actionEntityType = 'ContestPlatform::Action';

type ContestPolicyAction = 'CreateSubmission' | 'UploadArtifact' | 'ViewSubmissionSection';
type SubmissionSection = 'author-identity' | 'ai-disclosure' | 'provenance' | 'artifacts';

interface ContestPolicyDecision {
  allowed: boolean;
  errors: string[];
}

interface SubmissionStats {
  submissionsByEntrant: number;
  submissionsByTeam: number;
}

function formatDetailedErrors(errors: Array<{ message: string; help: string | null }>): string[] {
  return errors.map((error) => [error.message, error.help].filter(Boolean).join(' '));
}

function buildPrincipalEntities(user: SessionUser | null | undefined) {
  const principalId = user?.id ?? 'anonymous';
  const principalRoles = user?.roles ?? ['public'];

  return {
    principal: { type: userEntityType, id: principalId },
    entities: [
      {
        uid: { type: userEntityType, id: principalId },
        attrs: {
          roles: principalRoles,
          displayName: user?.displayName ?? 'Anonymous',
          authSource: user?.authSource ?? 'anonymous',
        },
        parents: principalRoles.map((role) => ({ type: roleEntityType, id: role })),
      },
      ...principalRoles.map((role) => ({
        uid: { type: roleEntityType, id: role },
        attrs: {},
        parents: [],
      })),
    ],
  };
}

function buildContestResourceEntity(contest: ContestSummary) {
  return {
    uid: { type: contestEntityType, id: contest.id },
    attrs: {
      stage: contest.stage,
      minWords: contest.submissionPolicy.minWords,
      maxWords: contest.maxWords,
      allowsTeams: contest.allowsTeams,
      aiDisclosureMode: contest.aiDisclosureMode,
      categories: contest.categories,
      judgingFocus: contest.judgingFocus,
      requireSceneCards: contest.submissionPolicy.requireSceneCards,
      requireReproductionSteps: contest.submissionPolicy.requireReproductionSteps,
      requirePromptHistory: contest.submissionPolicy.requirePromptHistory,
      allowPublicReadingOptIn: contest.submissionPolicy.allowPublicReadingOptIn,
      maxSubmissionsPerEntrant: contest.submissionPolicy.maxSubmissionsPerEntrant,
      maxSubmissionsPerTeam: contest.submissionPolicy.maxSubmissionsPerTeam,
      maxArtifactsPerSubmission: contest.submissionPolicy.maxArtifactsPerSubmission,
      allowedArtifactTypes: contest.submissionPolicy.allowedArtifactTypes,
      judgeCanViewAuthorIdentity: contest.submissionPolicy.judgeCanViewAuthorIdentity,
      judgeCanViewAiDisclosure: contest.submissionPolicy.judgeCanViewAiDisclosure,
      judgeCanViewProvenance: contest.submissionPolicy.judgeCanViewProvenance,
      judgeCanViewArtifacts: contest.submissionPolicy.judgeCanViewArtifacts,
    },
    parents: [],
  };
}

function authorizeContestAction(
  contest: ContestSummary,
  policy: ContestSubmissionPolicy,
  action: ContestPolicyAction,
  context: Record<string, string | number | boolean | string[]>,
  user?: SessionUser | null,
): ContestPolicyDecision {
  const principal = buildPrincipalEntities(user);
  const resource = buildContestResourceEntity(contest);

  const answer = cedar.isAuthorized({
    principal: principal.principal,
    action: { type: actionEntityType, id: action },
    resource: resource.uid,
    context,
    policies: { staticPolicies: policy.cedarPolicy },
    entities: [...principal.entities, resource],
  });

  if (answer.type === 'failure') {
    return {
      allowed: false,
      errors: formatDetailedErrors(answer.errors),
    };
  }

  if (answer.response.decision === 'allow') {
    return { allowed: true, errors: [] };
  }

  return {
    allowed: false,
    errors: [],
  };
}

export function canManageContests(user?: SessionUser | null): boolean {
  return Boolean(user?.roles.some((role) => ['platform-admin', 'organizer'].includes(role)));
}

export function isContestVisibleToUser(
  contest: ContestSummary,
  user?: SessionUser | null,
  options?: { includeDrafts?: boolean },
): boolean {
  if (contest.stage !== 'draft') {
    return true;
  }

  return Boolean(options?.includeDrafts && canManageContests(user));
}

function buildSubmissionRequirementErrors(
  contest: ContestSummary,
  input: SubmissionCreateInput,
  stats: SubmissionStats,
): string[] {
  const errors: string[] = [];
  const sceneCardsText = input.provenance.sceneCardsText.trim();
  const reproductionStepsText = input.provenance.reproductionStepsText.trim();
  const promptHistoryText = input.provenance.promptHistoryText.trim();

  if (input.wordCount < contest.submissionPolicy.minWords) {
    errors.push(`This contest requires at least ${contest.submissionPolicy.minWords} words.`);
  }

  if (input.wordCount > contest.maxWords) {
    errors.push(`This contest caps submissions at ${contest.maxWords} words.`);
  }

  if (!contest.allowsTeams && input.teamId) {
    errors.push('This contest only accepts solo submissions.');
  }

  if (stats.submissionsByEntrant >= contest.submissionPolicy.maxSubmissionsPerEntrant) {
    errors.push(
      `This contest allows at most ${contest.submissionPolicy.maxSubmissionsPerEntrant} submission${contest.submissionPolicy.maxSubmissionsPerEntrant === 1 ? '' : 's'} per entrant.`,
    );
  }

  if (input.teamId && stats.submissionsByTeam >= contest.submissionPolicy.maxSubmissionsPerTeam) {
    errors.push(
      `This contest allows at most ${contest.submissionPolicy.maxSubmissionsPerTeam} submission${contest.submissionPolicy.maxSubmissionsPerTeam === 1 ? '' : 's'} per team.`,
    );
  }

  if (contest.submissionPolicy.requireSceneCards && sceneCardsText.length === 0) {
    errors.push('This contest requires scene cards or an equivalent planning summary.');
  }

  if (contest.submissionPolicy.requireReproductionSteps && reproductionStepsText.length === 0) {
    errors.push('This contest requires steps-to-reproduce documentation for the submission workflow.');
  }

  if (contest.submissionPolicy.requirePromptHistory && promptHistoryText.length === 0) {
    errors.push('This contest requires prompt history disclosure.');
  }

  if (!contest.submissionPolicy.allowPublicReadingOptIn && input.consent.allowPublicReading) {
    errors.push('This contest does not allow entrants to opt into public reading publication.');
  }

  return errors;
}

function buildArtifactRequirementErrors(contest: ContestSummary, artifactType: SubmissionArtifactType): string[] {
  if (contest.submissionPolicy.maxArtifactsPerSubmission <= 0) {
    return ['This contest does not allow artifact uploads.'];
  }

  if (contest.submissionPolicy.allowedArtifactTypes.includes(artifactType)) {
    return [];
  }

  return [
    `This contest does not allow artifact type "${artifactType}". Allowed types: ${contest.submissionPolicy.allowedArtifactTypes.join(', ')}.`,
  ];
}

export function validateContestSubmissionPolicy(policy: ContestSubmissionPolicy): ContestPolicyDecision {
  const parsed = cedar.checkParsePolicySet({
    staticPolicies: policy.cedarPolicy,
  });

  if (parsed.type === 'failure') {
    return {
      allowed: false,
      errors: formatDetailedErrors(parsed.errors),
    };
  }

  return {
    allowed: true,
    errors: [],
  };
}

export function authorizeSubmissionCreation(
  contest: ContestSummary,
  input: SubmissionCreateInput,
  stats: SubmissionStats,
  user?: SessionUser | null,
): ContestPolicyDecision {
  const requirementErrors = buildSubmissionRequirementErrors(contest, input, stats);
  const decision = authorizeContestAction(
    contest,
    contest.submissionPolicy,
    'CreateSubmission',
    {
      wordCount: input.wordCount,
      isTeamSubmission: input.teamId !== null,
      hasSceneCards: input.provenance.sceneCardsText.trim().length > 0,
      hasReproductionSteps: input.provenance.reproductionStepsText.trim().length > 0,
      hasPromptHistory: input.provenance.promptHistoryText.trim().length > 0,
      allowPublicReading: input.consent.allowPublicReading,
      allowResearchUse: input.consent.allowResearchUse,
      allowTrainingUse: input.consent.allowTrainingUse,
      requireAnonymization: input.consent.requireAnonymization,
      submissionsByEntrant: stats.submissionsByEntrant,
      submissionsByTeam: stats.submissionsByTeam,
    },
    user,
  );

  if (decision.allowed) {
    return decision;
  }

  return {
    allowed: false,
    errors: [...requirementErrors, ...decision.errors].filter((value, index, array) => array.indexOf(value) === index),
  };
}

export function authorizeArtifactUpload(
  contest: ContestSummary,
  artifactType: SubmissionArtifactType,
  currentArtifactCount: number,
  user?: SessionUser | null,
): ContestPolicyDecision {
  const requirementErrors = buildArtifactRequirementErrors(contest, artifactType);
  if (currentArtifactCount >= contest.submissionPolicy.maxArtifactsPerSubmission) {
    requirementErrors.push(
      `This contest allows at most ${contest.submissionPolicy.maxArtifactsPerSubmission} artifact${contest.submissionPolicy.maxArtifactsPerSubmission === 1 ? '' : 's'} per submission.`,
    );
  }
  const decision = authorizeContestAction(
    contest,
    contest.submissionPolicy,
    'UploadArtifact',
    {
      artifactType,
      currentArtifactCount,
    },
    user,
  );

  if (decision.allowed) {
    return decision;
  }

  return {
    allowed: false,
    errors: [...requirementErrors, ...decision.errors].filter((value, index, array) => array.indexOf(value) === index),
  };
}

export function authorizeSubmissionSectionView(
  contest: ContestSummary,
  section: SubmissionSection,
  user?: SessionUser | null,
): ContestPolicyDecision {
  if (!user) {
    return {
      allowed: false,
      errors: ['Authentication required.'],
    };
  }

  if (user.roles.some((role) => ['platform-admin', 'organizer', 'entrant'].includes(role))) {
    return {
      allowed: true,
      errors: [],
    };
  }

  const decision = authorizeContestAction(
    contest,
    contest.submissionPolicy,
    'ViewSubmissionSection',
    { section },
    user,
  );

  if (decision.allowed) {
    return decision;
  }

  return {
    allowed: false,
    errors: decision.errors.length > 0 ? decision.errors : [`Section "${section}" is hidden for judges by contest policy.`],
  };
}

export function filterEntryDetailForUser(detail: EntryDetail, user?: SessionUser | null): EntryDetail {
  const canViewAuthorIdentity = authorizeSubmissionSectionView(detail.contest, 'author-identity', user).allowed;
  const canViewAiDisclosure = authorizeSubmissionSectionView(detail.contest, 'ai-disclosure', user).allowed;
  const canViewProvenance = authorizeSubmissionSectionView(detail.contest, 'provenance', user).allowed;
  const canViewArtifacts = authorizeSubmissionSectionView(detail.contest, 'artifacts', user).allowed;

  return {
    ...detail,
    entry: {
      ...detail.entry,
      authors: canViewAuthorIdentity ? detail.entry.authors : ['Anonymous entrant'],
      teamId: canViewAuthorIdentity ? detail.entry.teamId : null,
      aiStatement: canViewAiDisclosure ? detail.entry.aiStatement : '',
    },
    provenance: canViewProvenance
      ? detail.provenance
      : {
          sceneCardsText: '',
          reproductionStepsText: '',
          promptHistoryText: '',
        },
    consent: canViewProvenance
      ? detail.consent
      : {
          allowResearchUse: false,
          allowTrainingUse: false,
          requireAnonymization: false,
          allowPublicReading: false,
          agreedAt: '',
        },
    artifacts: canViewArtifacts ? detail.artifacts : [],
    access: {
      canViewAuthorIdentity,
      canViewAiDisclosure,
      canViewProvenance,
      canViewArtifacts,
    },
  };
}
