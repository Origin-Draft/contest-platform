import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { normalizeContestSubmissionPolicy } from '@origin-draft/shared';

let app: FastifyInstance;
let uploadDir: string;
let submissionCounter = 0;

function devHeaders(displayName: string, roles: string[]) {
  return {
    'x-dev-user': displayName,
    'x-dev-email': `${displayName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    'x-dev-roles': roles.join(','),
  };
}

function buildMultipartPayload(filename: string, content: string, mimeType = 'text/plain') {
  const boundary = '----contest-platform-test-boundary';
  const payload = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${mimeType}`,
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );

  return {
    boundary,
    payload,
  };
}

async function createEntrantSubmission(displayName = 'Entrant User') {
  submissionCounter += 1;

  const response = await app.inject({
    method: 'POST',
    url: '/api/submissions',
    headers: {
      'content-type': 'application/json',
      ...devHeaders(displayName, ['entrant']),
    },
    payload: JSON.stringify({
      title: `Owned draft ${submissionCounter}`,
      contestId: 'contest-neon-ink',
      teamId: 'team-midnight-oil',
      authors: [displayName, 'Coauthor Example'],
      wordCount: 1800,
      aiStatement: 'We used AI for outlining and then revised every paragraph by hand.',
      manuscriptText:
        'This draft begins in the half-light of a monitor wall and keeps going until the people in the room remember they are allowed to refuse the obvious ending. The machine offers symmetry. The writers choose pressure, texture, and cost.\n\nBy the time the scene settles, every useful sentence has been tested against an actual human decision instead of a statistical shrug.',
      provenance: {
        sceneCardsText: 'Scene 1: setup. Scene 2: refusal. Scene 3: consequence.',
        reproductionStepsText: 'Outline, generate alternatives, rewrite manually, line edit.',
        promptHistoryText: 'Prompted for alternate scene turns and tonal contrast only.',
      },
      consent: {
        allowResearchUse: true,
        allowTrainingUse: false,
        requireAnonymization: true,
        allowPublicReading: true,
        agreedAt: new Date().toISOString(),
      },
      status: 'draft',
    }),
  });

  assert.equal(response.statusCode, 201, response.body);
  const body = response.json() as { submission: { id: string } };
  return body.submission.id;
}

async function createContest(overrides?: Partial<{ slug: string; title: string; tagline: string; stage: string }>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/contests',
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Organizer User', ['organizer']),
    },
    payload: JSON.stringify({
      slug: overrides?.slug ?? `draft-preview-${Date.now()}`,
      title: overrides?.title ?? 'Draft Preview Contest',
      tagline: overrides?.tagline ?? 'A contest used to verify draft visibility and submission controls.',
      stage: overrides?.stage ?? 'draft',
      opensAt: '2026-06-01T00:00:00.000Z',
      closesAt: '2026-07-01T00:00:00.000Z',
      maxWords: 5000,
      allowsTeams: true,
      aiDisclosureMode: 'contest-defined',
      categories: ['speculative'],
      judgingFocus: ['voice'],
      submissionPolicy: normalizeContestSubmissionPolicy({
        minWords: 1000,
        requireSceneCards: false,
        requireReproductionSteps: false,
        requirePromptHistory: false,
        allowPublicReadingOptIn: true,
        maxSubmissionsPerEntrant: 1,
        maxSubmissionsPerTeam: 1,
        maxArtifactsPerSubmission: 1,
        allowedArtifactTypes: ['supporting-note'],
        judgeCanViewAuthorIdentity: false,
        judgeCanViewAiDisclosure: false,
        judgeCanViewProvenance: false,
        judgeCanViewArtifacts: false,
      }),
    }),
  });

  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { contest: { id: string; title: string } };
}

before(async () => {
  uploadDir = await mkdtemp(path.join(os.tmpdir(), 'contest-platform-api-test-'));

  const config: AppConfig = {
    platformMode: 'development',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    databaseUrl: 'postgres://contest_user:change-me@127.0.0.1:9/contest_platform',
    databaseSsl: false,
    uploadDir,
    uploadMaxBytes: 50 * 1024 * 1024,
    corsAllowedOrigins: ['*'],
    allowDatabaseFallback: true,
    authDevBypass: true,
    authProvider: 'keycloak',
    storageProvider: 'local',
    webOrigin: 'http://localhost:5173',
    keycloakIssuerUrl: 'http://localhost:8080/realms/contest-platform',
    keycloakRealm: 'contest-platform',
    keycloakClientId: 'contest-platform-web',
    keycloakClientPublic: true,
    keycloakClientSecret: 'replace-with-real-secret',
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceRoleKey: '',
    supabaseJwtSecret: '',
  };

  app = await buildApp(config);
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(uploadDir, { recursive: true, force: true });
});

test('judge detail responses stay masked while organizer access remains complete', async () => {
  const upload = buildMultipartPayload('process-note.txt', 'artifact evidence from entrant workflow');
  const uploadResponse = await app.inject({
    method: 'POST',
    url: '/api/submissions/entry-001/artifacts?artifactType=supporting-note',
    headers: {
      ...devHeaders('Organizer User', ['organizer']),
      'content-type': `multipart/form-data; boundary=${upload.boundary}`,
    },
    payload: upload.payload,
  });

  assert.equal(uploadResponse.statusCode, 201, uploadResponse.body);
  const artifact = uploadResponse.json().artifact as { id: string; originalFilename: string };

  const judgeDetailResponse = await app.inject({
    method: 'GET',
    url: '/api/submissions/entry-001',
    headers: devHeaders('Dev Judge', ['judge']),
  });

  assert.equal(judgeDetailResponse.statusCode, 200, judgeDetailResponse.body);
  const judgeDetail = judgeDetailResponse.json() as {
    entry: { authors: string[]; teamId: string | null; aiStatement: string };
    provenance: { sceneCardsText: string; reproductionStepsText: string; promptHistoryText: string };
    consent: { agreedAt: string };
    artifacts: Array<unknown>;
    access: {
      canViewAuthorIdentity: boolean;
      canViewAiDisclosure: boolean;
      canViewProvenance: boolean;
      canViewArtifacts: boolean;
    };
  };

  assert.deepEqual(judgeDetail.entry.authors, ['Anonymous entrant']);
  assert.equal(judgeDetail.entry.teamId, null);
  assert.equal(judgeDetail.access.canViewAuthorIdentity, false);
  assert.equal(judgeDetail.access.canViewAiDisclosure, true);
  assert.notEqual(judgeDetail.entry.aiStatement, '');
  assert.equal(judgeDetail.access.canViewProvenance, false);
  assert.equal(judgeDetail.provenance.sceneCardsText, '');
  assert.equal(judgeDetail.provenance.reproductionStepsText, '');
  assert.equal(judgeDetail.provenance.promptHistoryText, '');
  assert.equal(judgeDetail.consent.agreedAt, '');
  assert.equal(judgeDetail.access.canViewArtifacts, false);
  assert.deepEqual(judgeDetail.artifacts, []);

  const organizerDetailResponse = await app.inject({
    method: 'GET',
    url: '/api/submissions/entry-001',
    headers: devHeaders('Organizer User', ['organizer']),
  });

  assert.equal(organizerDetailResponse.statusCode, 200, organizerDetailResponse.body);
  const organizerDetail = organizerDetailResponse.json() as {
    entry: { authors: string[]; teamId: string | null; aiStatement: string };
    artifacts: Array<{ id: string }>;
    access: {
      canViewAuthorIdentity: boolean;
      canViewAiDisclosure: boolean;
      canViewProvenance: boolean;
      canViewArtifacts: boolean;
    };
  };

  assert.notDeepEqual(organizerDetail.entry.authors, ['Anonymous entrant']);
  assert.ok(organizerDetail.entry.authors.length >= 2);
  assert.ok(organizerDetail.entry.authors.includes('Ari Vale'));
  assert.equal(organizerDetail.entry.teamId, 'team-midnight-oil');
  assert.notEqual(organizerDetail.entry.aiStatement, '');
  assert.equal(organizerDetail.access.canViewAuthorIdentity, true);
  assert.equal(organizerDetail.access.canViewAiDisclosure, true);
  assert.equal(organizerDetail.access.canViewProvenance, true);
  assert.equal(organizerDetail.access.canViewArtifacts, true);
  assert.ok(organizerDetail.artifacts.some((candidate) => candidate.id === artifact.id));

  const judgeArtifactResponse = await app.inject({
    method: 'GET',
    url: `/api/submissions/entry-001/artifacts/${artifact.id}/download`,
    headers: devHeaders('Dev Judge', ['judge']),
  });

  assert.equal(judgeArtifactResponse.statusCode, 403, judgeArtifactResponse.body);
  assert.match(judgeArtifactResponse.body, /hidden for judges by contest policy/i);

  const organizerArtifactResponse = await app.inject({
    method: 'GET',
    url: `/api/submissions/entry-001/artifacts/${artifact.id}/download`,
    headers: devHeaders('Organizer User', ['organizer']),
  });

  assert.equal(organizerArtifactResponse.statusCode, 200, organizerArtifactResponse.body);
  assert.match(String(organizerArtifactResponse.headers['content-disposition']), /process-note\.txt/);
  assert.match(organizerArtifactResponse.body, /artifact evidence from entrant workflow/);
});

test('judges cannot access the global submissions listing', async () => {
  const judgeListResponse = await app.inject({
    method: 'GET',
    url: '/api/submissions',
    headers: devHeaders('Dev Judge', ['judge']),
  });

  assert.equal(judgeListResponse.statusCode, 403, judgeListResponse.body);
  assert.match(judgeListResponse.body, /platform-admin, organizer, entrant/i);
});

test('entrant access is limited to owned submissions', async () => {
  const ownedEntryId = await createEntrantSubmission('Entrant User');

  const ownerListResponse = await app.inject({
    method: 'GET',
    url: '/api/submissions',
    headers: devHeaders('Entrant User', ['entrant']),
  });

  assert.equal(ownerListResponse.statusCode, 200, ownerListResponse.body);
  const ownerList = ownerListResponse.json() as { submissions: Array<{ id: string }> };
  assert.ok(ownerList.submissions.some((submission) => submission.id === ownedEntryId));

  const outsiderListResponse = await app.inject({
    method: 'GET',
    url: '/api/submissions',
    headers: devHeaders('Outside Entrant', ['entrant']),
  });

  assert.equal(outsiderListResponse.statusCode, 200, outsiderListResponse.body);
  const outsiderList = outsiderListResponse.json() as { submissions: Array<{ id: string }> };
  assert.ok(!outsiderList.submissions.some((submission) => submission.id === ownedEntryId));

  const outsiderDetailResponse = await app.inject({
    method: 'GET',
    url: `/api/submissions/${ownedEntryId}`,
    headers: devHeaders('Outside Entrant', ['entrant']),
  });

  assert.equal(outsiderDetailResponse.statusCode, 403, outsiderDetailResponse.body);
  assert.match(outsiderDetailResponse.body, /own submissions/i);

  const upload = buildMultipartPayload('outsider-note.txt', 'this should not upload');
  const outsiderArtifactUpload = await app.inject({
    method: 'POST',
    url: `/api/submissions/${ownedEntryId}/artifacts?artifactType=supporting-note`,
    headers: {
      ...devHeaders('Outside Entrant', ['entrant']),
      'content-type': `multipart/form-data; boundary=${upload.boundary}`,
    },
    payload: upload.payload,
  });

  assert.equal(outsiderArtifactUpload.statusCode, 403, outsiderArtifactUpload.body);
  assert.match(outsiderArtifactUpload.body, /upload artifacts to their own submissions/i);
});

test('judges may only open submissions assigned to them', async () => {
  const assignedJudgeResponse = await app.inject({
    method: 'GET',
    url: '/api/submissions/entry-001',
    headers: devHeaders('Dev Judge', ['judge']),
  });

  assert.equal(assignedJudgeResponse.statusCode, 200, assignedJudgeResponse.body);

  const otherJudgeResponse = await app.inject({
    method: 'GET',
    url: '/api/submissions/entry-001',
    headers: devHeaders('Other Judge', ['judge']),
  });

  assert.equal(otherJudgeResponse.statusCode, 403, otherJudgeResponse.body);
  assert.match(otherJudgeResponse.body, /assigned to them/i);
});

test('draft contests stay organizer-only unless explicitly previewed by an organizer', async () => {
  const created = await createContest({
    slug: `draft-preview-${Date.now()}`,
    title: 'Private Draft Contest',
  });

  const publicListResponse = await app.inject({
    method: 'GET',
    url: '/api/contests',
  });

  assert.equal(publicListResponse.statusCode, 200, publicListResponse.body);
  const publicList = publicListResponse.json() as { contests: Array<{ id: string }> };
  assert.ok(!publicList.contests.some((contest) => contest.id === created.contest.id));

  const organizerListResponse = await app.inject({
    method: 'GET',
    url: '/api/contests?includeDrafts=true',
    headers: devHeaders('Organizer User', ['organizer']),
  });

  assert.equal(organizerListResponse.statusCode, 200, organizerListResponse.body);
  const organizerList = organizerListResponse.json() as { contests: Array<{ id: string }> };
  assert.ok(organizerList.contests.some((contest) => contest.id === created.contest.id));

  const publicDetailResponse = await app.inject({
    method: 'GET',
    url: `/api/contests/${created.contest.id}`,
  });

  assert.equal(publicDetailResponse.statusCode, 404, publicDetailResponse.body);

  const organizerPreviewResponse = await app.inject({
    method: 'GET',
    url: `/api/contests/${created.contest.id}?includeDrafts=true`,
    headers: devHeaders('Organizer User', ['organizer']),
  });

  assert.equal(organizerPreviewResponse.statusCode, 200, organizerPreviewResponse.body);
  const organizerPreview = organizerPreviewResponse.json() as { contest: { id: string; stage: string } };
  assert.equal(organizerPreview.contest.id, created.contest.id);
  assert.equal(organizerPreview.contest.stage, 'draft');
});

test('contest submission criteria and artifact limits are enforced per contest', async () => {
  const created = await createContest({
    slug: `strict-rules-${Date.now()}`,
    title: 'Strict Rules Contest',
    stage: 'submission-open',
  });

  const tooShortResponse = await app.inject({
    method: 'POST',
    url: '/api/submissions',
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Entrant User', ['entrant']),
    },
    payload: JSON.stringify({
      title: 'Too short',
      contestId: created.contest.id,
      teamId: 'team-midnight-oil',
      authors: ['Entrant User'],
      wordCount: 500,
      aiStatement: 'Manual drafting after AI brainstorming.',
      manuscriptText: 'x'.repeat(120),
      provenance: {
        sceneCardsText: '',
        reproductionStepsText: '',
        promptHistoryText: '',
      },
      consent: {
        allowResearchUse: true,
        allowTrainingUse: false,
        requireAnonymization: true,
        allowPublicReading: true,
        agreedAt: new Date().toISOString(),
      },
      status: 'draft',
    }),
  });

  assert.equal(tooShortResponse.statusCode, 400, tooShortResponse.body);
  assert.match(tooShortResponse.body, /at least 1000 words/i);

  const firstSubmissionResponse = await app.inject({
    method: 'POST',
    url: '/api/submissions',
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Entrant User', ['entrant']),
    },
    payload: JSON.stringify({
      title: 'Valid submission',
      contestId: created.contest.id,
      teamId: 'team-midnight-oil',
      authors: ['Entrant User'],
      wordCount: 1500,
      aiStatement: 'Manual drafting after AI brainstorming and structural alternatives.',
      manuscriptText: `${'A well-formed manuscript sentence. '.repeat(40)}\n\n${'More text to satisfy the length floor. '.repeat(30)}`,
      provenance: {
        sceneCardsText: '',
        reproductionStepsText: '',
        promptHistoryText: '',
      },
      consent: {
        allowResearchUse: true,
        allowTrainingUse: false,
        requireAnonymization: true,
        allowPublicReading: true,
        agreedAt: new Date().toISOString(),
      },
      status: 'draft',
    }),
  });

  assert.equal(firstSubmissionResponse.statusCode, 201, firstSubmissionResponse.body);
  const firstSubmission = firstSubmissionResponse.json() as { submission: { id: string } };

  const secondSubmissionResponse = await app.inject({
    method: 'POST',
    url: '/api/submissions',
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Entrant User', ['entrant']),
    },
    payload: JSON.stringify({
      title: 'Second submission',
      contestId: created.contest.id,
      teamId: 'team-midnight-oil',
      authors: ['Entrant User'],
      wordCount: 1500,
      aiStatement: 'Another valid-looking submission body.',
      manuscriptText: `${'Another manuscript that should be rejected on count. '.repeat(35)}\n\n${'Supporting paragraph. '.repeat(25)}`,
      provenance: {
        sceneCardsText: '',
        reproductionStepsText: '',
        promptHistoryText: '',
      },
      consent: {
        allowResearchUse: true,
        allowTrainingUse: false,
        requireAnonymization: true,
        allowPublicReading: true,
        agreedAt: new Date().toISOString(),
      },
      status: 'draft',
    }),
  });

  assert.equal(secondSubmissionResponse.statusCode, 400, secondSubmissionResponse.body);
  assert.match(secondSubmissionResponse.body, /at most 1 submission/i);

  const firstUpload = buildMultipartPayload('note-1.txt', 'first artifact');
  const firstArtifactResponse = await app.inject({
    method: 'POST',
    url: `/api/submissions/${firstSubmission.submission.id}/artifacts?artifactType=supporting-note`,
    headers: {
      ...devHeaders('Entrant User', ['entrant']),
      'content-type': `multipart/form-data; boundary=${firstUpload.boundary}`,
    },
    payload: firstUpload.payload,
  });

  assert.equal(firstArtifactResponse.statusCode, 201, firstArtifactResponse.body);

  const secondUpload = buildMultipartPayload('note-2.txt', 'second artifact');
  const secondArtifactResponse = await app.inject({
    method: 'POST',
    url: `/api/submissions/${firstSubmission.submission.id}/artifacts?artifactType=supporting-note`,
    headers: {
      ...devHeaders('Entrant User', ['entrant']),
      'content-type': `multipart/form-data; boundary=${secondUpload.boundary}`,
    },
    payload: secondUpload.payload,
  });

  assert.equal(secondArtifactResponse.statusCode, 400, secondArtifactResponse.body);
  assert.match(secondArtifactResponse.body, /at most 1 artifact/i);
});

test('organizers cannot perform admin-only stage transitions', async () => {
  const { contest } = await createContest({
    slug: `admin-stage-test-${Date.now()}`,
    title: 'Admin Stage Test',
    stage: 'draft',
  });

  // Organizer can update non-privileged fields
  const editResponse = await app.inject({
    method: 'PATCH',
    url: `/api/contests/${contest.id}`,
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Organizer User', ['organizer']),
    },
    payload: JSON.stringify({ tagline: 'Updated by organizer' }),
  });
  assert.equal(editResponse.statusCode, 200, editResponse.body);

  // Organizer can move to 'published' (non-privileged)
  const publishResponse = await app.inject({
    method: 'PATCH',
    url: `/api/contests/${contest.id}`,
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Organizer User', ['organizer']),
    },
    payload: JSON.stringify({ stage: 'published' }),
  });
  assert.equal(publishResponse.statusCode, 200, publishResponse.body);

  // Organizer CANNOT open submissions (admin-only)
  const openResponse = await app.inject({
    method: 'PATCH',
    url: `/api/contests/${contest.id}`,
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Organizer User', ['organizer']),
    },
    payload: JSON.stringify({ stage: 'submission-open' }),
  });
  assert.equal(openResponse.statusCode, 403, openResponse.body);
  assert.match(openResponse.body, /platform admin/i);

  // Platform admin CAN open submissions
  const adminOpenResponse = await app.inject({
    method: 'PATCH',
    url: `/api/contests/${contest.id}`,
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Admin User', ['platform-admin']),
    },
    payload: JSON.stringify({ stage: 'submission-open' }),
  });
  assert.equal(adminOpenResponse.statusCode, 200, adminOpenResponse.body);

  // Organizer CANNOT finalize
  const finalizeResponse = await app.inject({
    method: 'PATCH',
    url: `/api/contests/${contest.id}`,
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Organizer User', ['organizer']),
    },
    payload: JSON.stringify({ stage: 'finalized' }),
  });
  assert.equal(finalizeResponse.statusCode, 403, finalizeResponse.body);

  // Organizer CANNOT set submission status (result selections are admin-only)
  const statusResponse = await app.inject({
    method: 'PATCH',
    url: '/api/submissions/entry-001/status',
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Organizer User', ['organizer']),
    },
    payload: JSON.stringify({ status: 'winner' }),
  });
  assert.equal(statusResponse.statusCode, 403, statusResponse.body);

  // Platform admin CAN set submission status
  const adminStatusResponse = await app.inject({
    method: 'PATCH',
    url: '/api/submissions/entry-001/status',
    headers: {
      'content-type': 'application/json',
      ...devHeaders('Admin User', ['platform-admin']),
    },
    payload: JSON.stringify({ status: 'winner' }),
  });
  assert.equal(adminStatusResponse.statusCode, 200, adminStatusResponse.body);
});
