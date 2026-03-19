import type { FastifyInstance } from 'fastify';
import type {
  ContestCreateInput,
  ContestUpdateInput,
  JudgingAssignmentCreateInput,
  ResultSelectionInput,
  ScorecardSubmitInput,
  SubmissionCreateInput,
} from '@origin-draft/shared';
import { randomUUID } from 'node:crypto';
import {
  normalizeContestSubmissionPolicy,
  submissionArtifactTypeSchema as submissionArtifactTypeValidator,
} from '@origin-draft/shared';
import { requireRoles } from '../../auth.js';
import type { ContestStore } from './store.js';
import type { ArtifactStorage } from '../../storage/local.js';
import {
  authorizeArtifactUpload,
  authorizeSubmissionCreation,
  canManageContests,
  authorizeSubmissionSectionView,
  filterEntryDetailForUser,
  validateContestSubmissionPolicy,
} from './policy.js';

function hasSubmissionAdminScope(roles: string[]) {
  return roles.some((role) => ['platform-admin', 'organizer'].includes(role));
}

function isPlatformAdmin(user: { roles: string[] } | null | undefined) {
  return Boolean(user?.roles.includes('platform-admin'));
}

/** Stages that only platform-admin may transition a contest into. */
const adminOnlyStages = new Set([
  'submission-open',
  'submission-closed',
  'judging',
  'finalized',
  'announced',
]);

function isEntrantScopedUser(user: { roles: string[] } | null | undefined) {
  return Boolean(user && user.roles.includes('entrant') && !hasSubmissionAdminScope(user.roles));
}

function isJudgeScopedUser(user: { roles: string[] } | null | undefined) {
  return Boolean(user && user.roles.includes('judge') && !hasSubmissionAdminScope(user.roles));
}

export async function registerContestRoutes(
  app: FastifyInstance,
  contestStore: ContestStore,
  artifactStorage: ArtifactStorage,
) {
  app.get('/api/contests', async (request) => {
    const query = request.query as { includeDrafts?: string };
    const includeDrafts = query.includeDrafts === 'true' && canManageContests(request.sessionUser);

    return {
      contests: await contestStore.listContests({ includeDrafts }),
    };
  });

  app.get('/api/contests/:contestId', async (request, reply) => {
    const params = request.params as { contestId: string };
    const query = request.query as { includeDrafts?: string };
    const includeDrafts = query.includeDrafts === 'true' && canManageContests(request.sessionUser);
    const detail = await contestStore.getContest(params.contestId, { includeDrafts });

    if (!detail) {
      return reply.code(404).send({
        message: `Contest ${params.contestId} was not found.`,
      });
    }

    return detail;
  });

  app.get('/api/results', async () => ({
    results: await contestStore.listPublishedResults(),
  }));

  app.get('/api/public/entries/:entryId', async (request, reply) => {
    const params = request.params as { entryId: string };
    const entry = await contestStore.getPublicEntry(params.entryId);

    if (!entry) {
      return reply.code(404).send({
        message: `Published entry ${params.entryId} was not found.`,
      });
    }

    return { entry };
  });

  app.post('/api/contests', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const body = request.body as ContestCreateInput;
    const payload: ContestCreateInput = {
      ...body,
      submissionPolicy: normalizeContestSubmissionPolicy(body.submissionPolicy),
    };
    const policyValidation = validateContestSubmissionPolicy(payload.submissionPolicy);

    if (!policyValidation.allowed) {
      return reply.code(400).send({
        message: policyValidation.errors.join(' '),
      });
    }

    try {
      const contest = await contestStore.createContest(payload);
      return reply.code(201).send({ contest });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Unable to create contest.',
      });
    }
  });

  app.patch('/api/contests/:contestId', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const params = request.params as { contestId: string };
    const body = request.body as ContestUpdateInput;

    // Stage transitions to live/judging/finalized/announced are admin-only
    if (body.stage && adminOnlyStages.has(body.stage) && !isPlatformAdmin(request.sessionUser)) {
      return reply.code(403).send({
        message: `Only platform admins may transition a contest to '${body.stage}'.`,
      });
    }

    const payload: ContestUpdateInput = body.submissionPolicy
      ? {
          ...body,
          submissionPolicy: normalizeContestSubmissionPolicy(body.submissionPolicy),
        }
      : body;

    if (payload.submissionPolicy) {
      const policyValidation = validateContestSubmissionPolicy(payload.submissionPolicy);
      if (!policyValidation.allowed) {
        return reply.code(400).send({
          message: policyValidation.errors.join(' '),
        });
      }
    }

    try {
      const contest = await contestStore.updateContest(params.contestId, payload);

      if (!contest) {
        return reply.code(404).send({
          message: `Contest ${params.contestId} was not found.`,
        });
      }

      return { contest };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Unable to update contest.',
      });
    }
  });

  app.get('/api/submissions', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'entrant')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const submissions = isEntrantScopedUser(request.sessionUser)
      ? await contestStore.listEntriesBySubmitter(request.sessionUser!.id)
      : await contestStore.listEntries();

    return {
      submissions,
    };
  });

  app.get('/api/submissions/:entryId', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'entrant', 'judge')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const params = request.params as { entryId: string };
    const detail = await contestStore.getEntry(params.entryId);

    if (!detail) {
      return reply.code(404).send({
        message: `Submission ${params.entryId} was not found.`,
      });
    }

    if (isEntrantScopedUser(request.sessionUser)) {
      const isOwner = await contestStore.isEntryOwnedBy(params.entryId, request.sessionUser!.id);
      if (!isOwner) {
        return reply.code(403).send({
          message: 'Entrants may only access their own submissions.',
        });
      }
    }

    if (isJudgeScopedUser(request.sessionUser)) {
      const isAssigned = detail.assignments.some((a) =>
        a.assignedJudgeUserId
          ? a.assignedJudgeUserId === request.sessionUser!.id
          : a.assignedJudge === request.sessionUser!.displayName,
      );
      if (!isAssigned) {
        return reply.code(403).send({
          message: 'Judges may only access submissions assigned to them.',
        });
      }
    }

    return filterEntryDetailForUser(detail, request.sessionUser);
  });

  app.post('/api/submissions/:entryId/artifacts', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'entrant')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const params = request.params as { entryId: string };
    const query = request.query as { artifactType?: string };

    const detail = await contestStore.getEntry(params.entryId);
    if (!detail) {
      return reply.code(404).send({
        message: `Submission ${params.entryId} was not found.`,
      });
    }

    if (isEntrantScopedUser(request.sessionUser)) {
      const isOwner = await contestStore.isEntryOwnedBy(params.entryId, request.sessionUser!.id);
      if (!isOwner) {
        return reply.code(403).send({
          message: 'Entrants may only upload artifacts to their own submissions.',
        });
      }
    }

    const artifactTypeResult = submissionArtifactTypeValidator.safeParse(query.artifactType ?? 'other');
    if (!artifactTypeResult.success) {
      return reply.code(400).send({
        message: 'Invalid artifact type.',
      });
    }

    const artifactDecision = authorizeArtifactUpload(
      detail.contest,
      artifactTypeResult.data,
      detail.artifacts.length,
      request.sessionUser,
    );
    if (!artifactDecision.allowed) {
      return reply.code(400).send({
        message: artifactDecision.errors.join(' ') || 'Artifact upload denied by contest policy.',
      });
    }

    const upload = await request.file();
    if (!upload) {
      return reply.code(400).send({
        message: 'No file upload was provided.',
      });
    }

    const artifactId = `artifact-${randomUUID()}`;
    const saved = await artifactStorage.saveArtifact({
      submissionId: params.entryId,
      artifactId,
      filename: upload.filename,
      stream: upload.file,
    });

    const artifact = await contestStore.createSubmissionArtifact({
      submissionId: params.entryId,
      artifactType: artifactTypeResult.data,
      originalFilename: upload.filename,
      storageKey: saved.storageKey,
      mimeType: upload.mimetype,
      sizeBytes: saved.sizeBytes,
    });

    return reply.code(201).send({ artifact });
  });

  app.get('/api/submissions/:entryId/artifacts/:artifactId/download', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'entrant', 'judge')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const params = request.params as { entryId: string; artifactId: string };
    const artifact = await contestStore.getSubmissionArtifact(params.artifactId);
    if (!artifact || artifact.submissionId !== params.entryId) {
      return reply.code(404).send({
        message: `Artifact ${params.artifactId} was not found.`,
      });
    }

    const detail = await contestStore.getEntry(params.entryId);
    if (!detail) {
      return reply.code(404).send({
        message: `Submission ${params.entryId} was not found.`,
      });
    }

    if (isEntrantScopedUser(request.sessionUser)) {
      const isOwner = await contestStore.isEntryOwnedBy(params.entryId, request.sessionUser!.id);
      if (!isOwner) {
        return reply.code(403).send({
          message: 'Entrants may only download artifacts from their own submissions.',
        });
      }
    }

    if (isJudgeScopedUser(request.sessionUser)) {
      const isAssigned = detail.assignments.some((a) =>
        a.assignedJudgeUserId
          ? a.assignedJudgeUserId === request.sessionUser!.id
          : a.assignedJudge === request.sessionUser!.displayName,
      );
      if (!isAssigned) {
        return reply.code(403).send({
          message: 'Judges may only access submissions assigned to them.',
        });
      }
    }

    const sectionDecision = authorizeSubmissionSectionView(detail.contest, 'artifacts', request.sessionUser);
    if (!sectionDecision.allowed) {
      return reply.code(403).send({
        message: sectionDecision.errors.join(' '),
      });
    }

    reply.type(artifact.mimeType);
    reply.header('Content-Disposition', artifactStorage.sanitizeForContentDisposition(artifact.originalFilename));
    return reply.send(artifactStorage.createReadStream(artifact.storageKey));
  });

  app.get('/api/judging/assignments', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'judge')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const currentUser = request.sessionUser;
    const judge = currentUser && currentUser.roles.includes('judge') && !currentUser.roles.includes('organizer')
      ? { userId: currentUser.id, displayName: currentUser.displayName }
      : undefined;

    return {
      assignments: await contestStore.listJudgeAssignments(judge),
    };
  });

  app.get('/api/judging/summary', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer')(request, reply);
    if (reply.sent) {
      return denied;
    }

    return {
      scoreboards: await contestStore.listContestScoreboards(),
    };
  });

  app.post('/api/judging/assignments', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const body = request.body as JudgingAssignmentCreateInput;

    try {
      const assignment = await contestStore.createJudgeAssignment(body);
      return reply.code(201).send({ assignment });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Unable to create judging assignment.',
      });
    }
  });

  app.post('/api/judging/scorecards', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'judge')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const body = request.body as ScorecardSubmitInput;

    try {
      const assignment = await contestStore.submitScorecard(
        body,
        request.sessionUser?.roles.includes('judge')
          ? { userId: request.sessionUser.id, displayName: request.sessionUser.displayName }
          : undefined,
      );
      return reply.code(201).send({ assignment });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Unable to submit scorecard.',
      });
    }
  });

  app.post('/api/submissions', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'entrant')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const body = request.body as SubmissionCreateInput;
    const contest = await contestStore.getContest(body.contestId, { includeDrafts: true });
    if (!contest) {
      return reply.code(404).send({
        message: `Contest ${body.contestId} was not found.`,
      });
    }

    const stats = await contestStore.getSubmissionCreationStats(
      body.contestId,
      request.sessionUser!.id,
      body.teamId,
    );

    const policyDecision = authorizeSubmissionCreation(contest.contest, body, stats, request.sessionUser);
    if (!policyDecision.allowed) {
      return reply.code(400).send({
        message: policyDecision.errors.join(' ') || 'Submission denied by contest policy.',
      });
    }

    try {
      const submission = await contestStore.createEntry(body, {
        id: request.sessionUser!.id,
        displayName: request.sessionUser!.displayName,
      });
      return reply.code(201).send({ submission });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Unable to create submission.',
      });
    }
  });

  app.patch('/api/submissions/:entryId/status', async (request, reply) => {
    const denied = await requireRoles('platform-admin')(request, reply);
    if (reply.sent) {
      return denied;
    }

    const params = request.params as { entryId: string };
    const body = request.body as ResultSelectionInput;

    try {
      const submission = await contestStore.updateEntryStatus(params.entryId, body);
      if (!submission) {
        return reply.code(404).send({
          message: `Submission ${params.entryId} was not found.`,
        });
      }

      return { submission };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Unable to update submission status.',
      });
    }
  });

  app.get('/api/teams', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer', 'entrant', 'judge')(request, reply);
    if (reply.sent) {
      return denied;
    }

    return {
      teams: await contestStore.listTeams(),
    };
  });

  app.get('/api/dashboard/organizer', async (request, reply) => {
    const denied = await requireRoles('platform-admin', 'organizer')(request, reply);
    if (reply.sent) {
      return denied;
    }

    return contestStore.getOrganizerDashboard();
  });
}
