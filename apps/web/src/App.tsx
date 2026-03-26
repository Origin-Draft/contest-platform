import type { FormEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  AiDisclosureMode,
  ContestCreateInput,
  ContestResults,
  ContestScoreboard,
  ContestSubmissionPolicy,
  ContestStage,
  ContestSummary,
  EntryDetail,
  EntrySummary,
  JudgingAssignment,
  JudgingAssignmentCreateInput,
  PublicReadingEntry,
  ResultSelectionInput,
  RubricDimension,
  ScorecardDimensionInput,
  ScorecardSubmitInput,
  SubmissionArtifact,
  SubmissionArtifactType,
  SubmissionCreateInput,
  Team,
} from '@origin-draft/shared';
import {
  buildContestSubmissionPolicyCedar,
  defaultContestSubmissionPolicy,
  normalizeContestSubmissionPolicy,
  submissionArtifactTypes,
} from '@origin-draft/shared';
import {
  buildAuthHeaders,
  useAuth,
  type AuthContextValue,
  type DevSessionState,
} from './auth';
import { apiUrl, siteModeConfig } from './site';

interface ContestResponse {
  contests: ContestSummary[];
}

interface OrganizerDashboardResponse {
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
    stage: ContestStage;
  }>;
}

interface ContestMutationResponse {
  contest: ContestSummary;
}

interface ContestDetailResponse {
  contest: ContestSummary;
  rubric: RubricDimension[];
  relatedEntries: EntrySummary[];
}

interface TeamResponse {
  teams: Team[];
}

interface SubmissionResponse {
  submissions: EntrySummary[];
}

interface SubmissionMutationResponse {
  submission: EntrySummary;
}

interface JudgingAssignmentsResponse {
  assignments: JudgingAssignment[];
}

interface JudgingAssignmentMutationResponse {
  assignment: JudgingAssignment;
}

interface ResultsResponse {
  results: ContestResults[];
}

interface JudgingSummaryResponse {
  scoreboards: ContestScoreboard[];
}

interface EntryDetailResponse extends EntryDetail {}

interface PublicEntryResponse {
  entry: PublicReadingEntry;
}

interface ArtifactMutationResponse {
  artifact: SubmissionArtifact;
}

type ContestFormState = ContestCreateInput & {
  categoriesText: string;
  judgingFocusText: string;
  policyDirty: boolean;
};

type SubmissionFormState = SubmissionCreateInput & {
  authorsText: string;
};

type AssignmentFormState = JudgingAssignmentCreateInput;

type ScorecardFormState = {
  assignmentId: string;
  recommendation: 'advance' | 'hold' | 'decline';
  overallComment: string;
  scores: Array<ScorecardDimensionInput>;
};

type ResultSelectionFormState = Record<string, Extract<EntrySummary['status'], 'submitted' | 'under-review' | 'finalist' | 'winner'>>;

const initialContestForm: ContestCreateInput = {
  slug: 'summer-draft-open',
  title: 'Summer Draft Open',
  tagline: 'A contest for bold, collaborative, AI-assisted fiction with a clean paper trail.',
  stage: 'draft',
  opensAt: '2026-06-01T00:00:00.000Z',
  closesAt: '2026-07-15T23:59:59.000Z',
  maxWords: 5000,
  allowsTeams: true,
  aiDisclosureMode: 'contest-defined',
  categories: ['speculative', 'literary'],
  judgingFocus: ['voice', 'structure', 'human-ai collaboration clarity'],
  submissionPolicy: normalizeContestSubmissionPolicy(defaultContestSubmissionPolicy),
};

const initialSubmissionForm: SubmissionFormState = {
  title: 'Untitled brave little draft',
  contestId: 'contest-neon-ink',
  teamId: 'team-midnight-oil',
  authors: ['Ari Vale', 'Sam Osei'],
  authorsText: 'Ari Vale, Sam Osei',
  wordCount: 2400,
  aiStatement: 'We used AI for ideation and structural alternatives, then revised all prose manually.',
  manuscriptText:
    'The city learned our names from error logs first. By the time the trains resumed their murmuring under the river, the draft had grown teeth. We fed the model fragments—weather reports, divorce transcripts, obsolete interface copy—and it kept returning a woman walking into the same bright room with a different grief each time.\n\nSo we kept only the repetitions that hurt. We let the machine suggest architecture, then tore out every elegant bridge that spared the characters their cost. What survived was stranger, more human, and difficult in the exact way we wanted: not polished into certainty, but alive enough to resist being finalized by anyone except the people willing to stay inside it.',
  provenance: {
    sceneCardsText: 'Scene 1: urban system glitch. Scene 2: model-generated variants. Scene 3: human revision toward grief and resistance.',
    reproductionStepsText: 'Generate alternates, rank by thematic pressure, rewrite manually, perform line-level voice pass.',
    promptHistoryText: 'Prompt chain focused on sequencing, tonal compression, and alternative endings.',
  },
  consent: {
    allowResearchUse: true,
    allowTrainingUse: false,
    requireAnonymization: true,
    allowPublicReading: true,
    agreedAt: '2026-03-19T12:00:00.000Z',
  },
  status: 'draft',
};

const initialAssignmentForm: AssignmentFormState = {
  contestId: 'contest-neon-ink',
  entryId: 'entry-001',
  assignedJudge: 'Dev Judge',
};

function createContestFormState(input: ContestCreateInput): ContestFormState {
  return {
    ...input,
    submissionPolicy: normalizeContestSubmissionPolicy(input.submissionPolicy),
    categoriesText: input.categories.join(', '),
    judgingFocusText: input.judgingFocus.join(', '),
    policyDirty: false,
  };
}

function updatePolicySettings(
  current: ContestFormState,
  updates: Partial<ContestSubmissionPolicy>,
): ContestFormState {
  const nextPolicy = normalizeContestSubmissionPolicy({
    ...current.submissionPolicy,
    ...updates,
    cedarPolicy:
      updates.cedarPolicy !== undefined
        ? updates.cedarPolicy
        : current.policyDirty
          ? current.submissionPolicy.cedarPolicy
          : buildContestSubmissionPolicyCedar({
              minWords: updates.minWords ?? current.submissionPolicy.minWords,
              requireSceneCards: updates.requireSceneCards ?? current.submissionPolicy.requireSceneCards,
              requireReproductionSteps:
                updates.requireReproductionSteps ?? current.submissionPolicy.requireReproductionSteps,
              requirePromptHistory: updates.requirePromptHistory ?? current.submissionPolicy.requirePromptHistory,
              allowPublicReadingOptIn:
                updates.allowPublicReadingOptIn ?? current.submissionPolicy.allowPublicReadingOptIn,
              maxSubmissionsPerEntrant:
                updates.maxSubmissionsPerEntrant ?? current.submissionPolicy.maxSubmissionsPerEntrant,
              maxSubmissionsPerTeam:
                updates.maxSubmissionsPerTeam ?? current.submissionPolicy.maxSubmissionsPerTeam,
              maxArtifactsPerSubmission:
                updates.maxArtifactsPerSubmission ?? current.submissionPolicy.maxArtifactsPerSubmission,
              allowedArtifactTypes:
                updates.allowedArtifactTypes ?? current.submissionPolicy.allowedArtifactTypes,
              judgeCanViewAuthorIdentity:
                updates.judgeCanViewAuthorIdentity ?? current.submissionPolicy.judgeCanViewAuthorIdentity,
              judgeCanViewAiDisclosure:
                updates.judgeCanViewAiDisclosure ?? current.submissionPolicy.judgeCanViewAiDisclosure,
              judgeCanViewProvenance:
                updates.judgeCanViewProvenance ?? current.submissionPolicy.judgeCanViewProvenance,
              judgeCanViewArtifacts:
                updates.judgeCanViewArtifacts ?? current.submissionPolicy.judgeCanViewArtifacts,
            }),
  });

  return {
    ...current,
    submissionPolicy: nextPolicy,
  };
}

const initialScorecardForm: ScorecardFormState = {
  assignmentId: 'assignment-001',
  recommendation: 'advance',
  overallComment: 'Strong control of voice and a convincing human-AI collaboration rationale.',
  scores: [
    { dimensionId: 'voice', score: 8, comment: 'Distinctive and controlled.' },
    { dimensionId: 'structure', score: 7, comment: 'Solid movement with minor drag.' },
    { dimensionId: 'impact', score: 8, comment: 'Memorable emotional and conceptual finish.' },
    { dimensionId: 'ai-craft', score: 9, comment: 'AI use is integrated transparently and productively.' },
  ],
};

async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  auth?: Pick<AuthContextValue, 'devSession' | 'accessToken'>,
): Promise<T> {
  const resolvedInput = typeof input === 'string' && input.startsWith('/api') ? apiUrl(input) : input;
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    ...(auth ? buildAuthHeaders(auth.devSession, auth.accessToken) : {}),
  };

  const response = await fetch(resolvedInput, {
    ...init,
    headers,
  });

  const data = (await response.json()) as T | { message?: string };
  if (!response.ok) {
    const maybeMessage =
      typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
        ? data.message
        : null;
    throw new Error(maybeMessage ?? `Request failed with ${response.status}`);
  }

  return data as T;
}

function useContests(devSession?: DevSessionState, accessToken?: string | null) {
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [contests, setContests] = useState<ContestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadContests() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchJson<ContestResponse>(
        includeDrafts ? '/api/contests?includeDrafts=true' : '/api/contests',
        undefined,
        devSession ? { devSession, accessToken: accessToken ?? null } : undefined,
      );
      setContests(data.contests);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadContests();
  }, [accessToken, devSession, includeDrafts]);

  return { contests, isLoading, error, reload: loadContests, includeDrafts, setIncludeDrafts };
}

function buildContestPayload(form: ContestFormState): ContestCreateInput {
  return {
    slug: form.slug,
    title: form.title,
    tagline: form.tagline,
    stage: form.stage,
    opensAt: form.opensAt,
    closesAt: form.closesAt,
    maxWords: form.maxWords,
    allowsTeams: form.allowsTeams,
    aiDisclosureMode: form.aiDisclosureMode,
    categories: csvToList(form.categoriesText),
    judgingFocus: csvToList(form.judgingFocusText),
    submissionPolicy: normalizeContestSubmissionPolicy(form.submissionPolicy),
  };
}

function csvToList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const isProduction = siteModeConfig.mode === 'production';

function Shell({ title, subtitle, children, showHeroDescription = false }: { title: string; subtitle?: string; children: ReactNode; showHeroDescription?: boolean }) {
  return (
    <div className="page-shell">
      <header className="hero">
        <div className="hero-topline">
          <p className="eyebrow">Origin Draft</p>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="hero-copy">{subtitle}</p>}
        {showHeroDescription && (
          <p className="hero-copy">
            Built for fair, transparent AI-assisted writing competitions.
          </p>
        )}
      </header>
      {children}
    </div>
  );
}

const devProfiles = [
  { label: 'Admin', icon: '🛡️', displayName: 'Admin User', email: 'admin@example.com', roles: ['platform-admin', 'organizer', 'judge', 'entrant'] },
  { label: 'Organizer', icon: '🏆', displayName: 'Organizer User', email: 'organizer@example.com', roles: ['organizer'] },
  { label: 'Judge', icon: '⚖️', displayName: 'Judge User', email: 'judge@example.com', roles: ['judge'] },
  { label: 'Entrant', icon: '✍️', displayName: 'Entrant User', email: 'entrant@example.com', roles: ['entrant'] },
] as const;

function DevToolbar({ auth }: { auth: AuthContextValue }) {
  if (!auth.config?.devBypassEnabled) return null;

  const activeRoles = auth.user?.roles ?? [];
  const activeProfile = devProfiles.find(
    (p) => p.roles.length === activeRoles.length && p.roles.every((r) => activeRoles.includes(r)),
  );
  const isVisitor = !auth.user;

  function switchTo(profile: (typeof devProfiles)[number] | null) {
    if (profile) {
      auth.updateDevSession({
        enabled: true,
        displayName: profile.displayName,
        email: profile.email,
        roles: [...profile.roles],
      });
    } else {
      auth.signOutDevSession();
    }
    void auth.reload();
  }

  return (
    <div className="dev-toolbar">
      <span className="dev-toolbar-label">Dev</span>
      {devProfiles.map((profile) => (
        <button
          key={profile.label}
          type="button"
          className={`dev-toolbar-btn${activeProfile === profile ? ' dev-toolbar-active' : ''}`}
          onClick={() => switchTo(profile)}
          title={`${profile.label} (${profile.roles.join(', ')})`}
        >
          <span className="dev-toolbar-icon">{profile.icon}</span>
        </button>
      ))}
      <button
        type="button"
        className={`dev-toolbar-btn${isVisitor ? ' dev-toolbar-active' : ''}`}
        onClick={() => switchTo(null)}
        title="Visitor (signed out)"
      >
        <span className="dev-toolbar-icon">👤</span>
      </button>
    </div>
  );
}

function passwordStrengthError(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(pw)) return 'Password must include at least one number or symbol.';
  return null;
}

function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [formError, setFormError] = useState<string | null>(null);
  const [signUpDone, setSignUpDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.user) {
      navigate(returnTo, { replace: true });
    }
  }, [auth.user, navigate, returnTo]);

  const switchMode = useCallback((next: 'signin' | 'signup') => {
    setMode(next);
    setFormError(null);
    setPassword('');
    setConfirmPassword('');
  }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (mode === 'signup') {
      const strengthErr = passwordStrengthError(password);
      if (strengthErr) { setFormError(strengthErr); return; }
      if (password !== confirmPassword) { setFormError('Passwords do not match.'); return; }
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        await auth.signUpWithEmail(email, password);
        setSignUpDone(true);
      } else {
        await auth.signInWithEmail(email, password);
        navigate(returnTo, { replace: true });
      }
    } catch (err) {
      setPassword('');
      setConfirmPassword('');
      setFormError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }, [auth, confirmPassword, email, mode, navigate, password, returnTo]);

  if (signUpDone) {
    return (
      <Shell title="Check your email">
        <section className="card card-accent login-card">
          <h2>Check your email</h2>
          <p>We sent a confirmation link to <strong>{email}</strong>. Click the link to activate your account, then come back and sign in.</p>
          <button className="button-primary" type="button" onClick={() => { setSignUpDone(false); setMode('signin'); }}>
            Back to sign in
          </button>
        </section>
      </Shell>
    );
  }

  return (
    <Shell title={mode === 'signin' ? 'Sign in' : 'Create account'}>
      <section className="card card-accent login-card">
        <h2>{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
        {formError ? <p className="status status-error">{formError}</p> : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="stack-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </label>
          {mode === 'signup' && (
            <label>
              Confirm password
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
            </label>
          )}
          {mode === 'signup' && (
            <p className="login-hint">At least 8 characters with one number or symbol.</p>
          )}
          <button className="button-primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="login-switch">
          {mode === 'signin' ? (
            <>Don&apos;t have an account? <button type="button" className="link-button" onClick={() => switchMode('signup')}>Create one</button></>
          ) : (
            <>Already have an account? <button type="button" className="link-button" onClick={() => switchMode('signin')}>Sign in</button></>
          )}
        </p>
      </section>
    </Shell>
  );
}

function AuthCallbackPage() {
  const auth = useAuth();

  return (
    <Shell title="Finishing sign-in">
      <section className="card card-accent">
        <h2>Completing sign-in</h2>
        {auth.isLoading ? <p className="status">Exchanging the authorization code and restoring your session…</p> : null}
        {auth.error ? <p className="status status-error">Unable to complete sign-in: {auth.error}</p> : null}
        {!auth.isLoading && !auth.error ? <p className="status">You’re signed in. Redirecting you back to the app…</p> : null}
        <div className="session-actions">
          <Link className="button-secondary inline-button" to="/">
            Return home
          </Link>
          {auth.error ? (
            <button className="button-primary" type="button" onClick={() => void auth.signIn()}>
              Try sign-in again
            </button>
          ) : null}
        </div>
      </section>
    </Shell>
  );
}

function RequireRoles({
  roles,
  title,
  children,
}: {
  roles: string[];
  title: string;
  children: ReactNode;
}) {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <Shell title={title}>
        <section className="card">
          <h2>Checking access</h2>
          <p className="status">Validating your session and role membership…</p>
        </section>
      </Shell>
    );
  }

  if (!auth.user) {
    return (
      <Shell title={title}>
        <section className="card empty-state">
          <h2>Sign in to continue</h2>
          <p>You need to be signed in to access this page.</p>
          <button className="button-primary" type="button" onClick={() => void auth.signIn()}>
            Sign In
          </button>
        </section>
      </Shell>
    );
  }

  if (!auth.user.roles.some((role) => roles.includes(role))) {
    return (
      <Shell title={title}>
        <section className="card empty-state">
          <h2>Access restricted</h2>
          <p>Your account doesn&apos;t have the required role for this page.</p>
          <Link className="button-secondary inline-button" to="/">
            Back to home
          </Link>
        </section>
      </Shell>
    );
  }

  return <>{children}</>;
}

const stageLabels: Record<string, string> = {
  draft: 'Draft',
  'submission-open': 'Open',
  'judging-in-progress': 'Judging',
  announced: 'Results',
  finalized: 'Closed',
  published: 'Closed',
};

function stageLabel(stage: string): string {
  return stageLabels[stage] ?? stage.replace(/-/g, ' ');
}

function HomePage() {
  const auth = useAuth();
  const { contests, isLoading, error } = useContests(auth.devSession, auth.accessToken);
  const [results, setResults] = useState<ContestResults[]>([]);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const liveContests = useMemo(
    () => contests.filter((contest) => contest.stage === 'submission-open' || contest.stage === 'published'),
    [contests],
  );

  useEffect(() => {
    async function loadResults() {
      try {
        setResultsError(null);
        const data = await fetchJson<ResultsResponse>('/api/results');
        setResults(data.results);
      } catch (loadError) {
        setResultsError(loadError instanceof Error ? loadError.message : 'Unknown error');
      }
    }

    void loadResults();
  }, []);

  return (
    <Shell title="Run AI-Assisted Writing Contests" showHeroDescription>

      {/* Hero CTAs */}
      <div className="hero-actions">
        <a href="#contests" className="button-primary inline-button">Enter a Contest</a>
        <Link to="/organizer" className="button-secondary inline-button">Run a Contest</Link>
      </div>

      {/* Trust strip */}
      <section className="trust-section">
        <h2 className="trust-heading">Why Origin Draft</h2>
        <div className="trust-strip">
          <div className="trust-item">
            <span className="trust-icon">🔒</span>
            <span>Blind judging</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">📜</span>
            <span>Provenance tracking</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">📋</span>
            <span>Structured scoring</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">⚖️</span>
            <span>AI disclosure rules</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="how-it-works section-divided">
        <h2>How it works</h2>
        <div className="grid three-up">
          <div className="step-card card">
            <span className="step-number">1</span>
            <h3>Create a contest</h3>
            <p>Rules, rubrics, deadlines.</p>
          </div>
          <div className="step-card card">
            <span className="step-number">2</span>
            <h3>Accept submissions</h3>
            <p>Entries with provenance and consent.</p>
          </div>
          <div className="step-card card">
            <span className="step-number">3</span>
            <h3>Judge &amp; publish</h3>
            <p>Blind scoring and results.</p>
          </div>
        </div>
      </section>

      {/* Role entry cards */}
      <section className="grid three-up section-divided">
        <Link to="/entrant" className="role-card card">
          <span className="role-icon">✍️</span>
          <h3>Enter a Contest</h3>
          <p>Submit writing and track results</p>
          <span className="role-cta">Enter <span className="cta-arrow">→</span></span>
        </Link>
        <Link to="/judge" className="role-card card">
          <span className="role-icon">⚖️</span>
          <h3>Judge Submissions</h3>
          <p>Score blinded entries</p>
          <span className="role-cta">Judge <span className="cta-arrow">→</span></span>
        </Link>
        <Link to="/organizer" className="role-card card">
          <span className="role-icon">🏆</span>
          <h3>Run a Contest</h3>
          <p>Create and manage competitions</p>
          <span className="role-cta">Organize <span className="cta-arrow">→</span></span>
        </Link>
      </section>

      {/* Active contests */}
      <section id="contests" className="section-divided">
        <div className="section-header">
          <h2>Active Contests</h2>
        </div>

        {isLoading ? <p className="status">Loading contests\u2026</p> : null}
        {error && !isLoading ? (
          <article className="card empty-state">
            <h3>No contests yet</h3>
            <p>Be the first to launch one.</p>
            <Link className="button-primary inline-button" to="/organizer">Create First Contest</Link>
          </article>
        ) : null}

        {!isLoading && !error && liveContests.length === 0 ? (
          <article className="card empty-state">
            <h3>No contests yet</h3>
            <p>Be the first to launch one.</p>
            <Link className="button-primary inline-button" to="/organizer">Create First Contest</Link>
          </article>
        ) : null}

        <div className="grid contest-grid">
          {liveContests.map((contest) => (
            <article className="card contest-card" key={contest.id}>
              <div className="contest-card-header">
                <span className={`stage-pill stage-${contest.stage}`}>{stageLabel(contest.stage)}</span>
              </div>
              <h3>{contest.title}</h3>
              <p>{contest.tagline}</p>
              <dl className="meta-grid">
                <div>
                  <dt>Deadline</dt>
                  <dd>{new Date(contest.closesAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt>Max words</dt>
                  <dd>{contest.maxWords.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Teams</dt>
                  <dd>{contest.allowsTeams ? 'Allowed' : 'Solo only'}</dd>
                </div>
                <div>
                  <dt>AI policy</dt>
                  <dd>{contest.aiDisclosureMode.replace(/-/g, ' ')}</dd>
                </div>
              </dl>
              {auth.user ? (
                <Link className="button-primary inline-button" to="/entrant">Enter</Link>
              ) : (
                <button className="button-primary" type="button" onClick={() => void auth.signIn()}>Sign in to enter</button>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Results preview */}
      <section>
        <div className="section-header">
          <h2>Results</h2>
        </div>

        {resultsError && (
          <article className="card empty-state">
            <h3>No results yet</h3>
            <p>Winners will appear here. Run a contest to publish your first results.</p>
          </article>
        )}

        {!resultsError && results.length === 0 ? (
          <article className="card empty-state">
            <h3>No results yet</h3>
            <p>Winners will appear here. Run a contest to publish your first results.</p>
          </article>
        ) : null}

        <div className="grid contest-grid">
          {results.map((result) => (
            <article className="card result-card" key={result.contest.id}>
              <h3>{result.contest.title}</h3>
              {result.winners.length > 0 && (
                <div className="result-section">
                  <h4>\ud83e\udd47 Winners</h4>
                  <ul className="result-list">
                    {result.winners.map((w) => (
                      <li key={w.entryId}>
                        <strong>{w.title}</strong>
                        <span>{w.authors.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.finalists.length > 0 && (
                <div className="result-section">
                  <h4>\ud83e\udd48 Finalists</h4>
                  <ul className="result-list">
                    {result.finalists.map((f) => (
                      <li key={f.entryId}>
                        <strong>{f.title}</strong>
                        <span>{f.authors.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link className="text-link" to="/results">View full results \u2192</Link>
            </article>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="site-footer">
        <p className="footer-trust">AI-assisted contests with transparent judging and structured evaluation.</p>
        <div className="footer-links">
        <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/resources">About</Link>
          <Link to="/resources">Resources</Link>
          <a href="mailto:hello@origindraft.com">Contact</a>
        </div>
        <p>&copy; {new Date().getFullYear()} Origin Draft &middot; Launch and run writing contests in minutes.</p>
      </footer>
    </Shell>
  );
}

function ResourcesPage() {
  return (
    <Shell title="Resources" subtitle="The open specifications and tools behind Origin Draft.">
      <section className="card card-accent">
        <h2>About Origin Draft</h2>
        <p>
          Origin Draft is a platform for running AI-assisted writing contests with structured
          provenance tracking, blind judging, and transparent process disclosure. It is built on
          a family of open specifications designed to bring rigor and reproducibility to creative
          AI workflows.
        </p>
      </section>

      <section className="grid two-up">
        <article className="card">
          <h2>CAP — Canonical Artifact Protocol</h2>
          <p>
            The domain-agnostic substrate for decomposing any artifact into epistemically-separated
            canonical structures: observables, structure, and interpretations. CAP guarantees
            lossless round-trip fidelity across tools and formats.
          </p>
          <p>
            <a className="text-link" href="https://github.com/origin-draft/sip-protocol" target="_blank" rel="noopener noreferrer">
              Specification on GitHub ↗
            </a>
          </p>
        </article>

        <article className="card">
          <h2>CAP Narrative Profile</h2>
          <p>
            The fiction-specific layer built on CAP. Registers vocabulary for characters, scenes,
            beats, narrative voice, and narratological theory — everything needed to represent
            prose fiction in structured, machine-readable form.
          </p>
          <p>
            <a className="text-link" href="https://github.com/origin-draft/gbr-protocol" target="_blank" rel="noopener noreferrer">
              Profile specification on GitHub ↗
            </a>
          </p>
        </article>

        <article className="card">
          <h2>Grimoire — Writing System</h2>
          <p>
            An author-led, AI-assisted writing system with fill-in templates grounded in literary
            theory. Grimoire bridges the gap between creative planning and structured AI context
            across concept, character, plot, drafting, and revision phases.
          </p>
          <p className="pill-row">
            <span className="pill">Not yet open-sourced</span>
          </p>
        </article>

        <article className="card">
          <h2>CAP Datasets</h2>
          <p>
            Training and evaluation data for the CAP Narrative Profile. Includes public-domain
            annotations, synthetic examples, and hand-annotated records for validating the profile
            and producing bidirectional scene-to-prose model pairs.
          </p>
          <p>
            <a className="text-link" href="https://github.com/origin-draft/cap-datasets" target="_blank" rel="noopener noreferrer">
              Dataset repository on GitHub ↗
            </a>
          </p>
        </article>
      </section>

      <section className="card">
        <h2>How it fits together</h2>
        <p>
          Grimoire produces the author-facing planning documents and AI prompts. Those documents
          generate training data captured in CAP Datasets, which validates against the Narrative
          Profile specification. The Narrative Profile extends the core CAP protocol. Origin Draft
          uses these standards to power contest provenance tracking, submission analysis, and
          structured judging workflows.
        </p>
        <div className="resource-diagram">
          <p>
            <strong>Grimoire</strong> (writing system) → <strong>CAP Datasets</strong> (training
            corpus) → <strong>CAP Narrative Profile</strong> (domain vocabulary) →{' '}
            <strong>CAP Core</strong> (epistemic substrate)
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Community &amp; contributing</h2>
        <p>
          Origin Draft and its specifications are developed in the open. Contributions,
          feedback, and discussion are welcome.
        </p>
        <p>
          <a className="text-link" href="https://github.com/origin-draft" target="_blank" rel="noopener noreferrer">
            Origin Draft on GitHub ↗
          </a>
        </p>
      </section>
    </Shell>
  );
}

function TermsPage() {
  return (
    <Shell title="Terms of Service">
      <section className="card card-accent">
        <h2>Terms of Service</h2>
        <p className="status">Last updated: {new Date().getFullYear()}</p>
        <p>
          Origin Draft is currently in early access. By using this platform you agree to participate
          in good faith and to submit only work you have the right to enter. Full terms will be
          published before the platform's public launch.
        </p>
      </section>
      <section className="card">
        <h2>Key Points</h2>
        <ul>
          <li>You retain ownership of all work you submit.</li>
          <li>Submissions are evaluated by human judges; AI tooling is used for analysis, not selection.</li>
          <li>AI usage in your work must be disclosed as part of the submission process.</li>
          <li>We do not sell your data to third parties.</li>
        </ul>
        <p>Questions? <a className="text-link" href="mailto:hello@origindraft.com">Contact us</a>.</p>
      </section>
    </Shell>
  );
}

function PrivacyPage() {
  return (
    <Shell title="Privacy Policy">
      <section className="card card-accent">
        <h2>Privacy Policy</h2>
        <p className="status">Last updated: {new Date().getFullYear()}</p>
        <p>
          Origin Draft collects only the information necessary to operate writing contests. Full
          privacy policy details will be published before the platform's public launch.
        </p>
      </section>
      <section className="card">
        <h2>What We Collect</h2>
        <ul>
          <li>Account credentials managed by our authentication provider (Supabase Auth).</li>
          <li>Contest submissions and associated metadata you provide.</li>
          <li>Standard server logs for security and debugging purposes.</li>
        </ul>
        <h2>What We Don't Do</h2>
        <ul>
          <li>We do not sell or share your personal data with third parties.</li>
          <li>We do not use submitted manuscripts to train AI models without explicit consent.</li>
        </ul>
        <p>Questions? <a className="text-link" href="mailto:hello@origindraft.com">Contact us</a>.</p>
      </section>
    </Shell>
  );
}

function ResultsPage() {
  const [results, setResults] = useState<ContestResults[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadResults() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchJson<ResultsResponse>('/api/results');
        setResults(data.results);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    void loadResults();
  }, []);

  return (
    <Shell title="Published Results" subtitle="Winners, finalists, and their stories.">

      {isLoading ? <p className="status">Loading results\u2026</p> : null}
      {error && !isLoading ? (
        <article className="card empty-state">
          <h3>No published results yet</h3>
          <p>Published results will appear here once contests are completed.</p>
        </article>
      ) : null}

      {!isLoading && !error && results.length === 0 ? (
        <article className="card empty-state">
          <h3>No published results yet</h3>
          <p>Published results will appear here once contests are completed.</p>
        </article>
      ) : null}

      <section className="grid contest-grid">
        {results.map((result) => (
          <article className="card result-card" key={result.contest.id}>
            <h2>\ud83c\udfc6 {result.contest.title}</h2>
            <p>{result.contest.tagline}</p>
            <div className="pill-row">
              <span className="pill">{result.winners.length} winner{result.winners.length === 1 ? '' : 's'}</span>
              <span className="pill">{result.finalists.length} finalist{result.finalists.length === 1 ? '' : 's'}</span>
            </div>
            {result.winners.length > 0 && (
              <div className="result-section">
                <h3>\ud83e\udd47 Winners</h3>
                <ul className="result-list">
                  {result.winners.map((winner) => (
                    <li key={winner.entryId}>
                      <strong>{winner.title}</strong>
                      <span>{winner.authors.join(', ')}</span>
                      <Link className="text-link" to={`/read/${winner.entryId}`}>
                        Read entry \u2192
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.finalists.length > 0 && (
              <div className="result-section">
                <h3>\ud83e\udd48 Finalists</h3>
                <ul className="result-list">
                  {result.finalists.map((finalist) => (
                    <li key={finalist.entryId}>
                      <strong>{finalist.title}</strong>
                      <span>{finalist.authors.join(', ')}</span>
                      <Link className="text-link" to={`/read/${finalist.entryId}`}>
                        Read entry \u2192
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </section>
    </Shell>
  );
}

function SubmissionDetailPage() {
  const auth = useAuth();
  const { entryId = '' } = useParams();
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<SubmissionArtifactType>('supporting-note');
  const [artifactFile, setArtifactFile] = useState<File | null>(null);
  const [artifactMessage, setArtifactMessage] = useState<string | null>(null);
  const allowedArtifactTypes = detail?.contest.submissionPolicy.allowedArtifactTypes ?? submissionArtifactTypes;
  const canUploadArtifacts = auth.user ? auth.user.roles.some((role) => ['entrant', 'organizer', 'platform-admin'].includes(role)) : false;

  useEffect(() => {
    if (!allowedArtifactTypes.includes(artifactType)) {
      setArtifactType(allowedArtifactTypes[0] ?? 'supporting-note');
    }
  }, [allowedArtifactTypes, artifactType]);

  async function loadDetail() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchJson<EntryDetailResponse>(`/api/submissions/${entryId}`, undefined, auth);
      setDetail(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    async function loadEntryDetail() {
      try {
        await loadDetail();
      } catch {
        // handled in loadDetail
      }
    }

    void loadEntryDetail();
  }, [auth.accessToken, auth.devSession, entryId]);

  async function handleArtifactUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!artifactFile) {
      setArtifactMessage('Choose a file before uploading.');
      return;
    }

    const formData = new FormData();
    formData.append('file', artifactFile);

    try {
      setArtifactMessage(null);
      const response = await fetch(apiUrl(`/api/submissions/${entryId}/artifacts?artifactType=${encodeURIComponent(artifactType)}`),
        {
          method: 'POST',
          headers: buildAuthHeaders(auth.devSession, auth.accessToken),
          body: formData,
        },
      );
      const data = (await response.json()) as ArtifactMutationResponse | { message?: string };
      if (!response.ok) {
        throw new Error(typeof data === 'object' && data && 'message' in data && typeof data.message === 'string' ? data.message : `Upload failed with ${response.status}`);
      }

      setArtifactMessage('Artifact uploaded.');
      setArtifactFile(null);
      await loadDetail();
    } catch (uploadError) {
      setArtifactMessage(uploadError instanceof Error ? uploadError.message : 'Unable to upload artifact');
    }
  }

  return (
    <Shell title="Submission detail">
      {isLoading ? <p className="status">Loading submission…</p> : null}
      {error ? <p className="status status-error">Unable to load submission: {error}</p> : null}
      {detail ? (
        <>
          <section className="card manuscript-card">
            <p className="contest-stage">{detail.entry.status.replace('-', ' ')}</p>
            <h2>{detail.entry.title}</h2>
            <p>
              {detail.contest.title} · {detail.access.canViewAuthorIdentity ? detail.entry.authors.join(', ') : 'Anonymous entrant'}
            </p>
            <div className="pill-row">
              <span className="pill">{detail.entry.wordCount.toLocaleString()} words</span>
              <span className="pill">{detail.assignments.length} assignment{detail.assignments.length === 1 ? '' : 's'}</span>
            </div>
            {detail.access.canViewAiDisclosure ? (
              <div className="meta-panel">
                <h3>AI disclosure</h3>
                <p>{detail.entry.aiStatement}</p>
              </div>
            ) : (
              <div className="meta-panel">
                <h3>AI disclosure</h3>
                <p>Hidden for judges by contest policy.</p>
              </div>
            )}
            {detail.access.canViewProvenance ? (
              <>
                <div className="grid two-up provenance-grid">
                  <div className="meta-panel">
                    <h3>Scene cards</h3>
                    <p>{detail.provenance.sceneCardsText || 'No scene cards submitted.'}</p>
                  </div>
                  <div className="meta-panel">
                    <h3>Steps to reproduce</h3>
                    <p>{detail.provenance.reproductionStepsText || 'No reproduction notes submitted.'}</p>
                  </div>
                </div>
                <div className="meta-panel">
                  <h3>Prompt history</h3>
                  <p>{detail.provenance.promptHistoryText || 'No prompt history submitted.'}</p>
                </div>
                <div className="grid two-up provenance-grid">
                  <div className="meta-panel">
                    <h3>Consent profile</h3>
                    <ul>
                      <li>Research use: {detail.consent.allowResearchUse ? 'allowed' : 'not allowed'}</li>
                      <li>Training use: {detail.consent.allowTrainingUse ? 'allowed' : 'not allowed'}</li>
                      <li>Anonymization required: {detail.consent.requireAnonymization ? 'yes' : 'no'}</li>
                      <li>Public reading: {detail.consent.allowPublicReading ? 'allowed' : 'not allowed'}</li>
                    </ul>
                  </div>
                  <div className="meta-panel">
                    <h3>Consent timestamp</h3>
                    <p>{detail.consent.agreedAt ? new Date(detail.consent.agreedAt).toLocaleString() : 'Not available'}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="meta-panel">
                <h3>Process provenance</h3>
                <p>Hidden for judges by contest policy.</p>
              </div>
            )}
            <article className="manuscript-body">
              {detail.entry.manuscriptText.split('\n\n').map((paragraph, index) => (
                <p key={`${detail.entry.id}-${index}`}>{paragraph}</p>
              ))}
            </article>
          </section>

          <section className="card">
            <h2>Review trail</h2>
            <div className="grid contest-grid">
              {detail.assignments.length === 0 ? (
                <article className="contest-list-row">
                  <div>
                    <h3>No assignments yet</h3>
                    <p>This entry has not entered the judging queue.</p>
                  </div>
                </article>
              ) : null}
              {detail.assignments.map((assignment) => (
                <article className="contest-list-row" key={assignment.id}>
                  <div>
                    <h3>{assignment.assignedJudge}</h3>
                    <p>{assignment.overallComment ?? 'No overall comment submitted yet.'}</p>
                  </div>
                  <div className="mini-meta">
                    <span>{assignment.status}</span>
                    <span>{assignment.recommendation ?? 'pending'}</span>
                    <span>{assignment.submittedAt ? new Date(assignment.submittedAt).toLocaleDateString() : 'not submitted'}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Artifacts</h2>
            {detail.access.canViewArtifacts ? (
              <>
                <p>
                  Allowed artifact types for this contest: {allowedArtifactTypes.join(', ')}.
                </p>
                {canUploadArtifacts ? (
                  <form className="stack-form" onSubmit={handleArtifactUpload}>
                    <div className="form-row">
                      <label>
                        <span>Artifact type</span>
                        <select value={artifactType} onChange={(event) => setArtifactType(event.target.value as SubmissionArtifactType)}>
                          {allowedArtifactTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>File</span>
                        <input type="file" onChange={(event) => setArtifactFile(event.target.files?.[0] ?? null)} />
                      </label>
                    </div>
                    <button className="button-primary" type="submit">
                      Upload artifact
                    </button>
                    {artifactMessage ? <p className="status">{artifactMessage}</p> : null}
                  </form>
                ) : null}

                <div className="grid contest-grid">
                  {detail.artifacts.length === 0 ? (
                    <article className="contest-list-row">
                      <div>
                        <h3>No artifacts yet</h3>
                        <p>This submission has no uploaded files yet.</p>
                      </div>
                    </article>
                  ) : null}

                  {detail.artifacts.map((artifact) => (
                    <article className="contest-list-row" key={artifact.id}>
                      <div>
                        <h3>{artifact.originalFilename}</h3>
                        <p>{artifact.artifactType}</p>
                        <a className="text-link" href={apiUrl(`/api/submissions/${detail.entry.id}/artifacts/${artifact.id}/download`)}>
                          Download artifact
                        </a>
                      </div>
                      <div className="mini-meta">
                        <span>{artifact.mimeType}</span>
                        <span>{(artifact.sizeBytes / 1024).toFixed(1)} KB</span>
                        <span>{new Date(artifact.uploadedAt).toLocaleDateString()}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p>Hidden for judges by contest policy.</p>
            )}
          </section>
        </>
      ) : null}
    </Shell>
  );
}

function ContestPreviewPage() {
  const auth = useAuth();
  const { contestId = '' } = useParams();
  const [detail, setDetail] = useState<ContestDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadContestPreview() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchJson<ContestDetailResponse>(
          `/api/contests/${contestId}?includeDrafts=true`,
          undefined,
          auth,
        );
        setDetail(data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    void loadContestPreview();
  }, [auth.accessToken, auth.devSession, contestId]);

  return (
    <Shell title={detail ? `${detail.contest.title} preview` : 'Contest preview'}>
      {!auth.user || !auth.user.roles.some((role) => ['organizer', 'platform-admin'].includes(role)) ? (
        <section className="card">
          <h2>Organizer access required</h2>
          <p>Draft previews are only visible to organizers and platform admins.</p>
        </section>
      ) : null}

      {isLoading ? <p className="status">Loading preview…</p> : null}
      {error ? <p className="status status-error">Unable to load contest preview: {error}</p> : null}

      {detail ? (
        <>
          <section className="card card-accent">
            <p className="contest-stage">{detail.contest.stage.replace('-', ' ')}</p>
            <h2>{detail.contest.title}</h2>
            <p>{detail.contest.tagline}</p>
            {detail.contest.stage === 'draft' ? (
              <p className="status">Draft preview only — this contest remains hidden from public listing until you move it out of draft.</p>
            ) : null}
            <div className="pill-row">
              <span className="pill">{detail.contest.submissionPolicy.minWords}–{detail.contest.maxWords} words</span>
              <span className="pill">{detail.contest.allowsTeams ? 'Teams allowed' : 'Solo only'}</span>
              <span className="pill">{detail.contest.aiDisclosureMode}</span>
              <span className="pill">{detail.relatedEntries.length} submission{detail.relatedEntries.length === 1 ? '' : 's'}</span>
            </div>
          </section>

          <section className="grid two-up">
            <article className="card">
              <h2>Submission criteria</h2>
              <ul>
                <li>Minimum words: {detail.contest.submissionPolicy.minWords}</li>
                <li>Maximum words: {detail.contest.maxWords}</li>
                <li>Max submissions per entrant: {detail.contest.submissionPolicy.maxSubmissionsPerEntrant}</li>
                <li>Max submissions per team: {detail.contest.submissionPolicy.maxSubmissionsPerTeam}</li>
                <li>Max artifacts per submission: {detail.contest.submissionPolicy.maxArtifactsPerSubmission}</li>
                <li>Allowed artifacts: {detail.contest.submissionPolicy.allowedArtifactTypes.join(', ')}</li>
              </ul>
            </article>
            <article className="card">
              <h2>Disclosure and judging rules</h2>
              <ul>
                <li>Scene cards: {detail.contest.submissionPolicy.requireSceneCards ? 'required' : 'optional'}</li>
                <li>Steps to reproduce: {detail.contest.submissionPolicy.requireReproductionSteps ? 'required' : 'optional'}</li>
                <li>Prompt history: {detail.contest.submissionPolicy.requirePromptHistory ? 'required' : 'optional'}</li>
                <li>Public reading opt-in: {detail.contest.submissionPolicy.allowPublicReadingOptIn ? 'available' : 'disabled'}</li>
                <li>Judge can view identity: {detail.contest.submissionPolicy.judgeCanViewAuthorIdentity ? 'yes' : 'no'}</li>
                <li>Judge can view AI disclosure: {detail.contest.submissionPolicy.judgeCanViewAiDisclosure ? 'yes' : 'no'}</li>
                <li>Judge can view provenance: {detail.contest.submissionPolicy.judgeCanViewProvenance ? 'yes' : 'no'}</li>
                <li>Judge can view artifacts: {detail.contest.submissionPolicy.judgeCanViewArtifacts ? 'yes' : 'no'}</li>
              </ul>
            </article>
          </section>

          <section className="card">
            <h2>Public-facing summary</h2>
            <p>Categories: {detail.contest.categories.join(', ')}</p>
            <p>Judging focus: {detail.contest.judgingFocus.join(', ')}</p>
            <p>
              Timeline: opens {new Date(detail.contest.opensAt).toLocaleString()} · closes {new Date(detail.contest.closesAt).toLocaleString()}
            </p>
          </section>
        </>
      ) : null}
    </Shell>
  );
}

function PublicReadingPage() {
  const { entryId = '' } = useParams();
  const [entry, setEntry] = useState<PublicReadingEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadEntry() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchJson<PublicEntryResponse>(`/api/public/entries/${entryId}`);
        setEntry(data.entry);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    void loadEntry();
  }, [entryId]);

  return (
    <Shell title="Public reading page">
      {isLoading ? <p className="status">Loading entry…</p> : null}
      {error ? <p className="status status-error">Unable to load published entry: {error}</p> : null}
      {entry ? (
        <section className="card manuscript-card">
          <p className="contest-stage">{entry.placement}</p>
          <h2>{entry.title}</h2>
          <p>{entry.contestTitle} · {entry.authors.join(', ')}</p>
          <div className="meta-panel">
            <h3>AI disclosure</h3>
            <p>{entry.aiStatement}</p>
          </div>
          <div className="meta-panel">
            <h3>Public reading rights</h3>
            <p>{entry.consent.allowPublicReading ? 'Approved for public reading.' : 'Public reading not permitted.'}</p>
          </div>
          <article className="manuscript-body">
            {entry.manuscriptText.split('\n\n').map((paragraph, index) => (
              <p key={`${entry.entryId}-${index}`}>{paragraph}</p>
            ))}
          </article>
        </section>
      ) : null}
    </Shell>
  );
}

function EntrantPage() {
  const auth = useAuth();
  const { contests, isLoading: isContestLoading, error: contestError } = useContests(auth.devSession, auth.accessToken);
  const [teams, setTeams] = useState<Team[]>([]);
  const [submissions, setSubmissions] = useState<EntrySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<SubmissionFormState>(initialSubmissionForm);
  const selectedContest = useMemo(
    () => contests.find((contest) => contest.id === form.contestId) ?? null,
    [contests, form.contestId],
  );

  useEffect(() => {
    if (selectedContest && !selectedContest.allowsTeams && form.teamId) {
      setForm((current) => ({ ...current, teamId: null }));
    }

    if (selectedContest && !selectedContest.submissionPolicy.allowPublicReadingOptIn && form.consent.allowPublicReading) {
      setForm((current) => ({
        ...current,
        consent: {
          ...current.consent,
          allowPublicReading: false,
        },
      }));
    }
  }, [selectedContest, form.teamId, form.consent.allowPublicReading]);

  async function loadEntrantData() {
    try {
      setIsLoading(true);
      setError(null);
      const [teamsResponse, submissionsResponse] = await Promise.all([
        fetch(apiUrl('/api/teams'), { headers: buildAuthHeaders(auth.devSession, auth.accessToken) }),
        fetch(apiUrl('/api/submissions'), { headers: buildAuthHeaders(auth.devSession, auth.accessToken) }),
      ]);

      if (!teamsResponse.ok || !submissionsResponse.ok) {
        throw new Error('Unable to load entrant workspace data.');
      }

      const teamsData = (await teamsResponse.json()) as TeamResponse;
      const submissionsData = (await submissionsResponse.json()) as SubmissionResponse;
      setTeams(teamsData.teams);
      setSubmissions(submissionsData.submissions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadEntrantData();
  }, [auth.accessToken, auth.devSession]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    const payload: SubmissionCreateInput = {
      title: form.title,
      contestId: form.contestId,
      teamId: form.teamId || null,
      authors: csvToList(form.authorsText),
      wordCount: form.wordCount,
      aiStatement: form.aiStatement,
      manuscriptText: form.manuscriptText,
      provenance: form.provenance,
      consent: {
        ...form.consent,
        agreedAt: new Date().toISOString(),
      },
      status: form.status,
    };

    try {
      const response = await fetch(apiUrl('/api/submissions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(auth.devSession, auth.accessToken),
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as SubmissionMutationResponse | { message: string };
      if (!response.ok) {
        throw new Error('message' in data ? data.message : `Submission failed with ${response.status}`);
      }

      if (!('submission' in data)) {
        throw new Error('Submission response did not include the created submission payload.');
      }

      setSaveMessage(`Saved ${data.submission.title}.`);
      setForm((current) => ({ ...current, title: 'Another impossible little masterpiece' }));
      await loadEntrantData();
    } catch (submitError) {
      setSaveMessage(submitError instanceof Error ? submitError.message : 'Unable to save submission');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Shell title="Entrant portal">
      <section className="grid two-up">
        {!auth.user || !auth.user.roles.some((role) => ['entrant', 'organizer', 'platform-admin'].includes(role)) ? (
          <article className="card">
            <h2>Entrant access required</h2>
            <p>Sign in as an entrant, organizer, or platform admin to create and view submissions.</p>
          </article>
        ) : null}
        <article className="card">
          <h2>Submission flow</h2>
          <ol>
            <li>Create or join a writing team.</li>
            <li>Select a contest and verify eligibility.</li>
            <li>Upload the manuscript and complete the contest-specific AI disclosure.</li>
            <li>Track the submission from draft to judging and results.</li>
          </ol>

          <h3>Available contests</h3>
          {isContestLoading ? <p className="status">Loading contests…</p> : null}
          {contestError ? <p className="status status-error">{contestError}</p> : null}
          <ul>
            {contests.map((contest) => (
              <li key={contest.id}>
                {contest.title} — {contest.maxWords.toLocaleString()} words max — {contest.aiDisclosureMode}
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Create a submission</h2>
          {selectedContest ? (
            <div className="meta-panel">
              <h3>{selectedContest.title} requirements</h3>
              <ul>
                <li>Scene cards: {selectedContest.submissionPolicy.requireSceneCards ? 'required' : 'optional'}</li>
                <li>Steps to reproduce: {selectedContest.submissionPolicy.requireReproductionSteps ? 'required' : 'optional'}</li>
                <li>Prompt history: {selectedContest.submissionPolicy.requirePromptHistory ? 'required' : 'optional'}</li>
                <li>Minimum words: {selectedContest.submissionPolicy.minWords}</li>
                <li>Maximum submissions per entrant: {selectedContest.submissionPolicy.maxSubmissionsPerEntrant}</li>
                <li>Maximum submissions per team: {selectedContest.submissionPolicy.maxSubmissionsPerTeam}</li>
                <li>Public reading opt-in: {selectedContest.submissionPolicy.allowPublicReadingOptIn ? 'available' : 'disabled for this contest'}</li>
                <li>Maximum artifacts per submission: {selectedContest.submissionPolicy.maxArtifactsPerSubmission}</li>
                <li>Artifact types later allowed: {selectedContest.submissionPolicy.allowedArtifactTypes.join(', ')}</li>
              </ul>
            </div>
          ) : null}
          <form className="stack-form" onSubmit={handleSubmit}>
            <label>
              <span>Title</span>
              <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              <span>Contest</span>
              <select value={form.contestId} onChange={(event) => setForm((current) => ({ ...current, contestId: event.target.value }))}>
                {contests.map((contest) => (
                  <option key={contest.id} value={contest.id}>
                    {contest.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Team</span>
              <select
                value={form.teamId ?? ''}
                onChange={(event) => setForm((current) => ({ ...current, teamId: event.target.value || null }))}
                disabled={selectedContest ? !selectedContest.allowsTeams : false}
              >
                <option value="">Solo submission</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Authors</span>
              <input value={form.authorsText} onChange={(event) => setForm((current) => ({ ...current, authorsText: event.target.value }))} />
            </label>
            <label>
              <span>Word count</span>
              <input
                type="number"
                min={selectedContest?.submissionPolicy.minWords ?? 1}
                max={selectedContest?.maxWords}
                value={form.wordCount}
                onChange={(event) => setForm((current) => ({ ...current, wordCount: Number(event.target.value) }))}
              />
            </label>
            <label>
              <span>AI disclosure</span>
              <textarea value={form.aiStatement} onChange={(event) => setForm((current) => ({ ...current, aiStatement: event.target.value }))} rows={4} />
            </label>
            <label>
              <span>Manuscript text</span>
              <textarea value={form.manuscriptText} onChange={(event) => setForm((current) => ({ ...current, manuscriptText: event.target.value }))} rows={10} />
            </label>
            <label>
              <span>
                Scene cards{selectedContest?.submissionPolicy.requireSceneCards ? ' *' : ''}
              </span>
              <textarea
                required={selectedContest?.submissionPolicy.requireSceneCards}
                value={form.provenance.sceneCardsText}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    provenance: { ...current.provenance, sceneCardsText: event.target.value },
                  }))
                }
                rows={4}
              />
            </label>
            <label>
              <span>
                Steps to reproduce{selectedContest?.submissionPolicy.requireReproductionSteps ? ' *' : ''}
              </span>
              <textarea
                required={selectedContest?.submissionPolicy.requireReproductionSteps}
                value={form.provenance.reproductionStepsText}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    provenance: { ...current.provenance, reproductionStepsText: event.target.value },
                  }))
                }
                rows={4}
              />
            </label>
            <label>
              <span>
                Prompt history{selectedContest?.submissionPolicy.requirePromptHistory ? ' *' : ''}
              </span>
              <textarea
                required={selectedContest?.submissionPolicy.requirePromptHistory}
                value={form.provenance.promptHistoryText}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    provenance: { ...current.provenance, promptHistoryText: event.target.value },
                  }))
                }
                rows={6}
              />
            </label>
            <div className="consent-grid">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.consent.allowResearchUse}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      consent: { ...current.consent, allowResearchUse: event.target.checked },
                    }))
                  }
                />
                <span>Allow research use</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.consent.allowTrainingUse}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      consent: { ...current.consent, allowTrainingUse: event.target.checked },
                    }))
                  }
                />
                <span>Allow training use</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.consent.requireAnonymization}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      consent: { ...current.consent, requireAnonymization: event.target.checked },
                    }))
                  }
                />
                <span>Require anonymization before reuse</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.consent.allowPublicReading}
                  disabled={selectedContest ? !selectedContest.submissionPolicy.allowPublicReadingOptIn : false}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      consent: { ...current.consent, allowPublicReading: event.target.checked },
                    }))
                  }
                />
                <span>
                  {selectedContest?.submissionPolicy.allowPublicReadingOptIn
                    ? 'Allow public reading if selected'
                    : 'Public reading opt-in disabled for this contest'}
                </span>
              </label>
            </div>
            <button className="button-primary" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save submission'}
            </button>
            {saveMessage ? <p className="status">{saveMessage}</p> : null}
            {error ? <p className="status status-error">{error}</p> : null}
          </form>
        </article>
      </section>

      <section className="card">
        <h2>Your submission queue</h2>
        {isLoading ? <p className="status">Loading submissions…</p> : null}
        <div className="grid contest-grid">
          {submissions.map((submission) => (
            <article className="contest-list-row" key={submission.id}>
              <div>
                <h3>{submission.title}</h3>
                <p>{submission.aiStatement}</p>
                <Link className="text-link" to={`/submissions/${submission.id}`}>
                  Open manuscript
                </Link>
              </div>
              <div className="mini-meta">
                <span>{submission.status}</span>
                <span>{submission.wordCount.toLocaleString()} words</span>
                <span>{submission.authors.join(', ')}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}

function JudgePage() {
  const auth = useAuth();
  const [assignments, setAssignments] = useState<JudgingAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ScorecardFormState>(initialScorecardForm);

  async function loadAssignments() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchJson<JudgingAssignmentsResponse>(
        '/api/judging/assignments',
        undefined,
        auth,
      );
      setAssignments(data.assignments);
      const firstAssignment = data.assignments[0];
      if (firstAssignment) {
        setForm((current) => ({ ...current, assignmentId: firstAssignment.id }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAssignments();
  }, [auth.accessToken, auth.devSession]);

  async function handleScorecardSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveMessage(null);

    const payload: ScorecardSubmitInput = {
      assignmentId: form.assignmentId,
      recommendation: form.recommendation,
      overallComment: form.overallComment,
      scores: form.scores,
    };

    try {
      const data = await fetchJson<JudgingAssignmentMutationResponse>(
        '/api/judging/scorecards',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        auth,
      );
      setSaveMessage(`Submitted scorecard for ${data.assignment.entryTitle}.`);
      await loadAssignments();
    } catch (submitError) {
      setSaveMessage(submitError instanceof Error ? submitError.message : 'Unable to submit scorecard');
    }
  }

  const activeAssignment = assignments.find((assignment) => assignment.id === form.assignmentId) ?? assignments[0] ?? null;

  return (
    <Shell title="Judge portal">
      <section className="grid two-up">
        {!auth.user || !auth.user.roles.some((role) => ['judge', 'organizer', 'platform-admin'].includes(role)) ? (
          <article className="card">
            <h2>Judge access required</h2>
            <p>Sign in as a judge, organizer, or platform admin to view assignments and score entries.</p>
          </article>
        ) : null}
        <article className="card">
          <h2>Blind review workflow</h2>
          <p>
            Judges receive assignments, review anonymized entries, score weighted rubric dimensions,
            and submit written rationale without seeing entrant identities.
          </p>
          {isLoading ? <p className="status">Loading assignments…</p> : null}
          {error ? <p className="status status-error">{error}</p> : null}
          <div className="grid contest-grid">
            {assignments.map((assignment) => (
              <article className="contest-list-row" key={assignment.id}>
                <div>
                  <h3>{assignment.entryTitle}</h3>
                  <p>{assignment.assignedJudge} · {assignment.status}</p>
                  <Link className="text-link" to={`/submissions/${assignment.entryId}`}>
                    Open manuscript
                  </Link>
                </div>
                <div className="mini-meta">
                  <span>{new Date(assignment.assignedAt).toLocaleDateString()}</span>
                  <span>{assignment.recommendation ?? 'pending'}</span>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Submit scorecard</h2>
          <form className="stack-form" onSubmit={handleScorecardSubmit}>
            <label>
              <span>Assignment</span>
              <select value={form.assignmentId} onChange={(event) => setForm((current) => ({ ...current, assignmentId: event.target.value }))}>
                {assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.entryTitle}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Recommendation</span>
              <select value={form.recommendation} onChange={(event) => setForm((current) => ({ ...current, recommendation: event.target.value as ScorecardFormState['recommendation'] }))}>
                <option value="advance">advance</option>
                <option value="hold">hold</option>
                <option value="decline">decline</option>
              </select>
            </label>
            {form.scores.map((score, index) => (
              <div className="score-block" key={score.dimensionId}>
                <h3>{score.dimensionId}</h3>
                <label>
                  <span>Score</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={score.score}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scores: current.scores.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, score: Number(event.target.value) }
                            : candidate,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Comment</span>
                  <textarea
                    rows={2}
                    value={score.comment}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scores: current.scores.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, comment: event.target.value }
                            : candidate,
                        ),
                      }))
                    }
                  />
                </label>
              </div>
            ))}
            <label>
              <span>Overall comment</span>
              <textarea rows={4} value={form.overallComment} onChange={(event) => setForm((current) => ({ ...current, overallComment: event.target.value }))} />
            </label>
            <button className="button-primary" type="submit">
              Submit scorecard
            </button>
            {saveMessage ? <p className="status">{saveMessage}</p> : null}
            {activeAssignment ? <p className="status">Scoring: {activeAssignment.entryTitle}</p> : null}
          </form>
        </article>
      </section>
    </Shell>
  );
}

function OrganizerPage() {
  const auth = useAuth();
  const { contests, isLoading, error, reload, setIncludeDrafts } = useContests(auth.devSession, auth.accessToken);
  const [submissions, setSubmissions] = useState<EntrySummary[]>([]);
  const [assignments, setAssignments] = useState<JudgingAssignment[]>([]);
  const [dashboard, setDashboard] = useState<OrganizerDashboardResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [scoreboards, setScoreboards] = useState<ContestScoreboard[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [resultsMessage, setResultsMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ContestFormState>(() => createContestFormState(initialContestForm));
  const [editingContestId, setEditingContestId] = useState<string | null>(null);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(initialAssignmentForm);
  const isAdmin = auth.user?.roles.includes('platform-admin') ?? false;

  const [resultSelections, setResultSelections] = useState<ResultSelectionFormState>({});

  useEffect(() => {
    setIncludeDrafts(true);
  }, [setIncludeDrafts]);

  useEffect(() => {
    async function loadOrganizerResources() {
      try {
        const [submissionsData, assignmentsData, scoreboardsData] = await Promise.all([
          fetchJson<SubmissionResponse>('/api/submissions', undefined, auth),
          fetchJson<JudgingAssignmentsResponse>('/api/judging/assignments', undefined, auth),
          fetchJson<JudgingSummaryResponse>('/api/judging/summary', undefined, auth),
        ]);
        setSubmissions(submissionsData.submissions);
        setAssignments(assignmentsData.assignments);
        setScoreboards(scoreboardsData.scoreboards);
        setResultSelections((current) => {
          const next: ResultSelectionFormState = { ...current };
          submissionsData.submissions.forEach((submission) => {
            if (
              submission.status === 'submitted' ||
              submission.status === 'under-review' ||
              submission.status === 'finalist' ||
              submission.status === 'winner'
            ) {
              next[submission.id] = submission.status;
            } else if (!next[submission.id]) {
              next[submission.id] = 'under-review';
            }
          });
          return next;
        });
      } catch (loadError) {
        setDashboardError(loadError instanceof Error ? loadError.message : 'Unknown error');
      }
    }

    void loadOrganizerResources();
  }, [auth.accessToken, auth.devSession, contests.length]);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setDashboardError(null);
        const response = await fetch(apiUrl('/api/dashboard/organizer'), {
          headers: buildAuthHeaders(auth.devSession, auth.accessToken),
        });
        if (!response.ok) {
          throw new Error(`Dashboard request failed with ${response.status}`);
        }

        const data = (await response.json()) as OrganizerDashboardResponse;
        setDashboard(data);
      } catch (loadError) {
        setDashboardError(loadError instanceof Error ? loadError.message : 'Unknown error');
      }
    }

    void loadDashboard();
  }, [auth.accessToken, auth.devSession, contests.length]);

  async function handleSaveContest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);
    const payload = buildContestPayload(form);

    try {
      const response = await fetch(editingContestId ? apiUrl(`/api/contests/${editingContestId}`) : apiUrl('/api/contests'), {
        method: editingContestId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(auth.devSession, auth.accessToken),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Create contest failed with ${response.status}`);
      }

      const data = (await response.json()) as ContestMutationResponse;
      setEditingContestId(data.contest.id);
      setForm(createContestFormState(data.contest));
      setSaveMessage(`${editingContestId ? 'Updated' : 'Created'} ${data.contest.title}.`);
      await reload();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : 'Unable to save contest');
    } finally {
      setIsSaving(false);
    }
  }

  function startEditingContest(contest: ContestSummary) {
    setEditingContestId(contest.id);
    setForm(createContestFormState(contest));
    setSaveMessage(null);
  }

  function resetContestEditor() {
    setEditingContestId(null);
    setForm(createContestFormState(initialContestForm));
    setSaveMessage(null);
  }

  async function handleCreateAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAssignmentMessage(null);

    try {
      const data = await fetchJson<JudgingAssignmentMutationResponse>(
        '/api/judging/assignments',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(assignmentForm),
        },
        auth,
      );
      setAssignmentMessage(`Assigned ${data.assignment.entryTitle} to ${data.assignment.assignedJudge}.`);
      const refreshedAssignments = await fetchJson<JudgingAssignmentsResponse>(
        '/api/judging/assignments',
        undefined,
        auth,
      );
      setAssignments(refreshedAssignments.assignments);
      const refreshedScoreboards = await fetchJson<JudgingSummaryResponse>(
        '/api/judging/summary',
        undefined,
        auth,
      );
      setScoreboards(refreshedScoreboards.scoreboards);
    } catch (saveError) {
      setAssignmentMessage(saveError instanceof Error ? saveError.message : 'Unable to create assignment');
    }
  }

  async function handleUpdateContestStage(contest: ContestSummary, stage: ContestStage) {
    setResultsMessage(null);

    try {
      const response = await fetch(apiUrl(`/api/contests/${contest.id}`),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...buildAuthHeaders(auth.devSession, auth.accessToken),
          },
          body: JSON.stringify({ stage }),
        },
      );

      const data = (await response.json()) as ContestMutationResponse | { message?: string };
      if (!response.ok) {
        throw new Error(typeof data === 'object' && data && 'message' in data && typeof data.message === 'string' ? data.message : `Update failed with ${response.status}`);
      }

      setResultsMessage(`Moved ${contest.title} to ${stage}.`);
      await reload();

      const refreshedScoreboards = await fetchJson<JudgingSummaryResponse>(
        '/api/judging/summary',
        undefined,
        auth,
      );
      setScoreboards(refreshedScoreboards.scoreboards);
    } catch (saveError) {
      setResultsMessage(saveError instanceof Error ? saveError.message : 'Unable to update contest stage');
    }
  }

  async function handleUpdateSubmissionStatus(entryId: string) {
    setResultsMessage(null);

    try {
      const payload: ResultSelectionInput = {
        status: resultSelections[entryId] ?? 'under-review',
      };
      const data = await fetchJson<SubmissionMutationResponse>(
        `/api/submissions/${entryId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        auth,
      );
      setResultsMessage(`Updated ${data.submission.title} to ${data.submission.status}.`);

      const refreshedSubmissions = await fetchJson<SubmissionResponse>('/api/submissions', undefined, auth);
      setSubmissions(refreshedSubmissions.submissions);
      const refreshedScoreboards = await fetchJson<JudgingSummaryResponse>(
        '/api/judging/summary',
        undefined,
        auth,
      );
      setScoreboards(refreshedScoreboards.scoreboards);
    } catch (saveError) {
      setResultsMessage(saveError instanceof Error ? saveError.message : 'Unable to update submission result');
    }
  }

  return (
    <Shell title="Organizer admin">
      <section className="grid two-up">
        {!auth.user || !auth.user.roles.some((role) => ['organizer', 'platform-admin'].includes(role)) ? (
          <article className="card">
            <h2>Organizer access required</h2>
            <p>Sign in as an organizer or platform admin to manage contests and view the organizer dashboard.</p>
          </article>
        ) : null}
        <article className="card">
          <h2>Control center</h2>
          <p>
            Create contests, define rules and rubric weights, assign judges, move stages forward, and
            publish finalists, winners, and public reading pages.
          </p>

          {dashboard ? (
            <div className="stats-grid">
              <div className="stat-card">
                <strong>{dashboard.stats.contests}</strong>
                <span>contests</span>
              </div>
              <div className="stat-card">
                <strong>{dashboard.stats.teams}</strong>
                <span>teams</span>
              </div>
              <div className="stat-card">
                <strong>{dashboard.stats.submissions}</strong>
                <span>submissions</span>
              </div>
              <div className="stat-card">
                <strong>{dashboard.stats.judgingAssignments}</strong>
                <span>assignments</span>
              </div>
            </div>
          ) : null}

          {dashboardError ? <p className="status status-error">{dashboardError}</p> : null}

          <h3>Upcoming milestones</h3>
          <ul>
            {dashboard?.upcomingMilestones.map((milestone) => (
              <li key={milestone.contestId}>
                {milestone.title} — {milestone.stage} until {new Date(milestone.closesAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>{editingContestId ? 'Edit contest' : 'Create a contest'}</h2>
          <form className="stack-form" onSubmit={handleSaveContest}>
            <label>
              <span>Title</span>
              <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              <span>Slug</span>
              <input value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} />
            </label>
            <label>
              <span>Tagline</span>
              <textarea value={form.tagline} onChange={(event) => setForm((current) => ({ ...current, tagline: event.target.value }))} rows={3} />
            </label>
            <div className="form-row">
              <label>
                <span>Stage</span>
                <select value={form.stage} onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value as ContestStage }))}>
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  {isAdmin && (
                    <>
                      <option value="submission-open">submission-open</option>
                      <option value="submission-closed">submission-closed</option>
                      <option value="judging">judging</option>
                      <option value="finalized">finalized</option>
                      <option value="announced">announced</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                <span>Opens at</span>
                <input type="datetime-local" value={form.opensAt.slice(0, 16)} onChange={(event) => setForm((current) => ({ ...current, opensAt: `${event.target.value}:00.000Z` }))} />
              </label>
              <label>
                <span>Closes at</span>
                <input type="datetime-local" value={form.closesAt.slice(0, 16)} onChange={(event) => setForm((current) => ({ ...current, closesAt: `${event.target.value}:00.000Z` }))} />
              </label>
            </div>
            <div className="form-row">
              <label>
                <span>Max words</span>
                <input type="number" min={100} value={form.maxWords} onChange={(event) => setForm((current) => ({ ...current, maxWords: Number(event.target.value) }))} />
              </label>
              <label>
                <span>AI disclosure</span>
                <select value={form.aiDisclosureMode} onChange={(event) => setForm((current) => ({ ...current, aiDisclosureMode: event.target.value as AiDisclosureMode }))}>
                  <option value="required">required</option>
                  <option value="optional">optional</option>
                  <option value="contest-defined">contest-defined</option>
                </select>
              </label>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.allowsTeams} onChange={(event) => setForm((current) => ({ ...current, allowsTeams: event.target.checked }))} />
              <span>Allow team submissions</span>
            </label>
            <label>
              <span>Categories</span>
              <input value={form.categoriesText} onChange={(event) => setForm((current) => ({ ...current, categoriesText: event.target.value }))} />
            </label>
            <label>
              <span>Judging focus</span>
              <input value={form.judgingFocusText} onChange={(event) => setForm((current) => ({ ...current, judgingFocusText: event.target.value }))} />
            </label>
            <div className="meta-panel">
              <h3>Submission policy</h3>
              <div className="form-row">
                <label>
                  <span>Minimum words</span>
                  <input
                    type="number"
                    min={1}
                    max={form.maxWords}
                    value={form.submissionPolicy.minWords}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          minWords: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  <span>Max submissions per entrant</span>
                  <input
                    type="number"
                    min={1}
                    value={form.submissionPolicy.maxSubmissionsPerEntrant}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          maxSubmissionsPerEntrant: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  <span>Max submissions per team</span>
                  <input
                    type="number"
                    min={1}
                    value={form.submissionPolicy.maxSubmissionsPerTeam}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          maxSubmissionsPerTeam: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  <span>Max artifacts per submission</span>
                  <input
                    type="number"
                    min={1}
                    value={form.submissionPolicy.maxArtifactsPerSubmission}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          maxArtifactsPerSubmission: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
              </div>
              <div className="consent-grid">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.requireSceneCards}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          requireSceneCards: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Require scene cards</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.requireReproductionSteps}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          requireReproductionSteps: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Require steps to reproduce</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.requirePromptHistory}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          requirePromptHistory: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Require prompt history</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.allowPublicReadingOptIn}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          allowPublicReadingOptIn: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Allow public reading opt-in</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.judgeCanViewAuthorIdentity}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          judgeCanViewAuthorIdentity: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Judges can see author identity</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.judgeCanViewAiDisclosure}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          judgeCanViewAiDisclosure: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Judges can see AI disclosure</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.judgeCanViewProvenance}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          judgeCanViewProvenance: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Judges can see provenance bundle</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.submissionPolicy.judgeCanViewArtifacts}
                    onChange={(event) =>
                      setForm((current) =>
                        updatePolicySettings(current, {
                          judgeCanViewArtifacts: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>Judges can see artifacts</span>
                </label>
              </div>

              <div className="stack-form">
                <span>Allowed artifact types</span>
                <div className="consent-grid">
                  {submissionArtifactTypes.map((type) => {
                    const checked = form.submissionPolicy.allowedArtifactTypes.includes(type);
                    const isOnlyOption = checked && form.submissionPolicy.allowedArtifactTypes.length === 1;

                    return (
                      <label className="checkbox-row" key={type}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isOnlyOption}
                          onChange={(event) => {
                            const nextAllowed = event.target.checked
                              ? [...form.submissionPolicy.allowedArtifactTypes, type]
                              : form.submissionPolicy.allowedArtifactTypes.filter((candidate) => candidate !== type);

                            setForm((current) =>
                              updatePolicySettings(current, {
                                allowedArtifactTypes: nextAllowed,
                              }),
                            );
                          }}
                        />
                        <span>{type}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label>
                <span>Cedar policy</span>
                <textarea
                  rows={14}
                  value={form.submissionPolicy.cedarPolicy}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      submissionPolicy: normalizeContestSubmissionPolicy({
                        ...current.submissionPolicy,
                        cedarPolicy: event.target.value,
                      }),
                      policyDirty: true,
                    }))
                  }
                />
              </label>
              <div className="session-actions">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      submissionPolicy: normalizeContestSubmissionPolicy({
                        ...current.submissionPolicy,
                        cedarPolicy: buildContestSubmissionPolicyCedar({
                          minWords: current.submissionPolicy.minWords,
                          requireSceneCards: current.submissionPolicy.requireSceneCards,
                          requireReproductionSteps: current.submissionPolicy.requireReproductionSteps,
                          requirePromptHistory: current.submissionPolicy.requirePromptHistory,
                          allowPublicReadingOptIn: current.submissionPolicy.allowPublicReadingOptIn,
                          maxSubmissionsPerEntrant: current.submissionPolicy.maxSubmissionsPerEntrant,
                          maxSubmissionsPerTeam: current.submissionPolicy.maxSubmissionsPerTeam,
                          maxArtifactsPerSubmission: current.submissionPolicy.maxArtifactsPerSubmission,
                          allowedArtifactTypes: current.submissionPolicy.allowedArtifactTypes,
                          judgeCanViewAuthorIdentity: current.submissionPolicy.judgeCanViewAuthorIdentity,
                          judgeCanViewAiDisclosure: current.submissionPolicy.judgeCanViewAiDisclosure,
                          judgeCanViewProvenance: current.submissionPolicy.judgeCanViewProvenance,
                          judgeCanViewArtifacts: current.submissionPolicy.judgeCanViewArtifacts,
                        }),
                      }),
                      policyDirty: false,
                    }))
                  }
                >
                  Regenerate Cedar policy from toggles
                </button>
                {editingContestId ? (
                  <button className="button-secondary" type="button" onClick={resetContestEditor}>
                    Stop editing
                  </button>
                ) : null}
              </div>
            </div>
            <button className="button-primary" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : editingContestId ? 'Save contest' : 'Create contest'}
            </button>
            {saveMessage ? <p className="status">{saveMessage}</p> : null}
          </form>
        </article>
      </section>

      <section className="grid two-up">
        <article className="card">
          <h2>Assign judges</h2>
          <form className="stack-form" onSubmit={handleCreateAssignment}>
            <label>
              <span>Contest</span>
              <select value={assignmentForm.contestId} onChange={(event) => setAssignmentForm((current) => ({ ...current, contestId: event.target.value }))}>
                {contests.map((contest) => (
                  <option key={contest.id} value={contest.id}>
                    {contest.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Submission</span>
              <select value={assignmentForm.entryId} onChange={(event) => setAssignmentForm((current) => ({ ...current, entryId: event.target.value }))}>
                {submissions
                  .filter((submission) => submission.contestId === assignmentForm.contestId)
                  .map((submission) => (
                    <option key={submission.id} value={submission.id}>
                      {submission.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Judge name</span>
              <input value={assignmentForm.assignedJudge} onChange={(event) => setAssignmentForm((current) => ({ ...current, assignedJudge: event.target.value }))} />
            </label>
            <button className="button-primary" type="submit">
              Create assignment
            </button>
            {assignmentMessage ? <p className="status">{assignmentMessage}</p> : null}
          </form>
        </article>

        <article className="card">
          <h2>Judging queue</h2>
          <div className="grid contest-grid">
            {assignments.map((assignment) => (
              <article className="contest-list-row" key={assignment.id}>
                <div>
                  <h3>{assignment.entryTitle}</h3>
                  <p>{assignment.assignedJudge}</p>
                </div>
                <div className="mini-meta">
                  <span>{assignment.status}</span>
                  <span>{assignment.recommendation ?? 'pending'}</span>
                </div>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="card">
        <h2>Contest roster</h2>
        {isLoading ? <p className="status">Loading organizer roster…</p> : null}
        {error ? <p className="status status-error">{error}</p> : null}
        <div className="grid contest-grid">
          {contests.map((contest) => (
            <article className="contest-list-row" key={contest.id}>
              <div>
                <h3>{contest.title}</h3>
                <p>{contest.tagline}</p>
                <div className="stage-actions">
                  <button className="button-secondary" type="button" onClick={() => startEditingContest(contest)}>
                    Edit
                  </button>
                  <Link className="button-secondary inline-button" to={`/organizer/contests/${contest.id}/preview`}>
                    Preview
                  </Link>
                  {isAdmin && (
                    <>
                      <button className="button-secondary" type="button" onClick={() => void handleUpdateContestStage(contest, 'submission-open')}>
                        Open submissions
                      </button>
                      <button className="button-secondary" type="button" onClick={() => void handleUpdateContestStage(contest, 'judging')}>
                        Move to judging
                      </button>
                      <button className="button-secondary" type="button" onClick={() => void handleUpdateContestStage(contest, 'finalized')}>
                        Finalize
                      </button>
                      <button className="button-primary" type="button" onClick={() => void handleUpdateContestStage(contest, 'announced')}>
                        Announce
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mini-meta">
                <span>{contest.stage}</span>
                <span>{contest.submissionPolicy.minWords}–{contest.maxWords} words</span>
                <span>{contest.submissionPolicy.maxSubmissionsPerEntrant} per entrant</span>
                <span>{contest.allowsTeams ? 'Teams on' : 'Solo only'}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {isAdmin && (
      <section className="card">
        <h2>Results publishing</h2>
        <p>Promote strong entries to finalists or winners, then announce the contest to make those placements public.</p>
        {resultsMessage ? <p className="status">{resultsMessage}</p> : null}
        <div className="grid contest-grid">
          {submissions.map((submission) => (
            <article className="result-admin-row" key={submission.id}>
              <div>
                <h3>{submission.title}</h3>
                <p>{submission.authors.join(', ')}</p>
                <Link className="text-link" to={`/submissions/${submission.id}`}>
                  Open manuscript
                </Link>
              </div>
              <div className="result-admin-controls">
                <select
                  value={resultSelections[submission.id] ?? (submission.status === 'winner' || submission.status === 'finalist' || submission.status === 'submitted' || submission.status === 'under-review' ? submission.status : 'under-review')}
                  onChange={(event) =>
                    setResultSelections((current) => ({
                      ...current,
                      [submission.id]: event.target.value as ResultSelectionFormState[string],
                    }))
                  }
                >
                  <option value="submitted">submitted</option>
                  <option value="under-review">under-review</option>
                  <option value="finalist">finalist</option>
                  <option value="winner">winner</option>
                </select>
                <button className="button-primary" type="button" onClick={() => void handleUpdateSubmissionStatus(submission.id)}>
                  Save result
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      )}

      <section className="card">
        <h2>Ranking board</h2>
        <p>Weighted rubric averages and recommendation counts, so finalists are picked with receipts.</p>
        <div className="grid contest-grid">
          {scoreboards.map((scoreboard) => (
            <article className="card result-card" key={scoreboard.contest.id}>
              <h3>{scoreboard.contest.title}</h3>
              <p>{scoreboard.contest.stage.replace('-', ' ')} · {scoreboard.entries.length} submission{scoreboard.entries.length === 1 ? '' : 's'}</p>
              <div className="ranking-list">
                {scoreboard.entries.map((entry) => (
                  <div className="ranking-row" key={entry.entryId}>
                    <div>
                      <strong>{entry.rank ? `#${entry.rank}` : '—'}</strong>
                      <h4>{entry.title}</h4>
                      <p>{entry.authors.join(', ')}</p>
                        <Link className="text-link" to={`/submissions/${entry.entryId}`}>
                          Open manuscript
                        </Link>
                    </div>
                    <div className="mini-meta">
                      <span>{entry.averageScore.toFixed(2)} / 10</span>
                      <span>{entry.reviewCount} review{entry.reviewCount === 1 ? '' : 's'}</span>
                      <span>
                        A/H/D {entry.recommendations.advance}/{entry.recommendations.hold}/{entry.recommendations.decline}
                      </span>
                      <span>{entry.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export function App() {
  const auth = useAuth();

  return (
    <div className="app-frame">
      <nav className="top-nav">
        <div className="nav-left">
          <Link to="/" className="nav-brand">Origin Draft</Link>
        </div>
        <div className="nav-links">
          <Link to="/#contests">Contests</Link>
          <Link to="/results">Results</Link>
          <Link to="/resources">Resources</Link>
        </div>
        <div className="nav-right">
          <DevToolbar auth={auth} />
          {auth.user ? (
            <>
              <span className="nav-user">{auth.user.displayName}</span>
              <button className="button-secondary nav-button" type="button" onClick={() => void auth.signOut()}>
                Sign Out
              </button>
            </>
          ) : auth.isLoading ? null : (
            <button className="button-primary nav-button" type="button" onClick={() => void auth.signIn()}>
              Sign In
            </button>
          )}
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/read/:entryId" element={<PublicReadingPage />} />
        <Route
          path="/submissions/:entryId"
          element={(
            <RequireRoles roles={['entrant', 'judge', 'organizer', 'platform-admin']} title="Submission detail">
              <SubmissionDetailPage />
            </RequireRoles>
          )}
        />
        <Route
          path="/entrant"
          element={(
            <RequireRoles roles={['entrant', 'organizer', 'platform-admin']} title="Entrant portal">
              <EntrantPage />
            </RequireRoles>
          )}
        />
        <Route
          path="/judge"
          element={(
            <RequireRoles roles={['judge', 'organizer', 'platform-admin']} title="Judge portal">
              <JudgePage />
            </RequireRoles>
          )}
        />
        <Route
          path="/organizer"
          element={(
            <RequireRoles roles={['organizer', 'platform-admin']} title="Organizer admin">
              <OrganizerPage />
            </RequireRoles>
          )}
        />
        <Route
          path="/organizer/contests/:contestId/preview"
          element={(
            <RequireRoles roles={['organizer', 'platform-admin']} title="Contest preview">
              <ContestPreviewPage />
            </RequireRoles>
          )}
        />
      </Routes>
    </div>
  );
}
