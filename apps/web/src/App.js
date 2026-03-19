import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { buildContestSubmissionPolicyCedar, defaultContestSubmissionPolicy, normalizeContestSubmissionPolicy, submissionArtifactTypes, } from '@origin-draft/shared';
import { buildAuthHeaders, useAuth, } from './auth';
import { apiUrl, siteModeConfig } from './site';
const initialContestForm = {
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
const initialSubmissionForm = {
    title: 'Untitled brave little draft',
    contestId: 'contest-neon-ink',
    teamId: 'team-midnight-oil',
    authors: ['Ari Vale', 'Sam Osei'],
    authorsText: 'Ari Vale, Sam Osei',
    wordCount: 2400,
    aiStatement: 'We used AI for ideation and structural alternatives, then revised all prose manually.',
    manuscriptText: 'The city learned our names from error logs first. By the time the trains resumed their murmuring under the river, the draft had grown teeth. We fed the model fragments—weather reports, divorce transcripts, obsolete interface copy—and it kept returning a woman walking into the same bright room with a different grief each time.\n\nSo we kept only the repetitions that hurt. We let the machine suggest architecture, then tore out every elegant bridge that spared the characters their cost. What survived was stranger, more human, and difficult in the exact way we wanted: not polished into certainty, but alive enough to resist being finalized by anyone except the people willing to stay inside it.',
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
const initialAssignmentForm = {
    contestId: 'contest-neon-ink',
    entryId: 'entry-001',
    assignedJudge: 'Dev Judge',
};
function createContestFormState(input) {
    return {
        ...input,
        submissionPolicy: normalizeContestSubmissionPolicy(input.submissionPolicy),
        categoriesText: input.categories.join(', '),
        judgingFocusText: input.judgingFocus.join(', '),
        policyDirty: false,
    };
}
function updatePolicySettings(current, updates) {
    const nextPolicy = normalizeContestSubmissionPolicy({
        ...current.submissionPolicy,
        ...updates,
        cedarPolicy: updates.cedarPolicy !== undefined
            ? updates.cedarPolicy
            : current.policyDirty
                ? current.submissionPolicy.cedarPolicy
                : buildContestSubmissionPolicyCedar({
                    minWords: updates.minWords ?? current.submissionPolicy.minWords,
                    requireSceneCards: updates.requireSceneCards ?? current.submissionPolicy.requireSceneCards,
                    requireReproductionSteps: updates.requireReproductionSteps ?? current.submissionPolicy.requireReproductionSteps,
                    requirePromptHistory: updates.requirePromptHistory ?? current.submissionPolicy.requirePromptHistory,
                    allowPublicReadingOptIn: updates.allowPublicReadingOptIn ?? current.submissionPolicy.allowPublicReadingOptIn,
                    maxSubmissionsPerEntrant: updates.maxSubmissionsPerEntrant ?? current.submissionPolicy.maxSubmissionsPerEntrant,
                    maxSubmissionsPerTeam: updates.maxSubmissionsPerTeam ?? current.submissionPolicy.maxSubmissionsPerTeam,
                    maxArtifactsPerSubmission: updates.maxArtifactsPerSubmission ?? current.submissionPolicy.maxArtifactsPerSubmission,
                    allowedArtifactTypes: updates.allowedArtifactTypes ?? current.submissionPolicy.allowedArtifactTypes,
                    judgeCanViewAuthorIdentity: updates.judgeCanViewAuthorIdentity ?? current.submissionPolicy.judgeCanViewAuthorIdentity,
                    judgeCanViewAiDisclosure: updates.judgeCanViewAiDisclosure ?? current.submissionPolicy.judgeCanViewAiDisclosure,
                    judgeCanViewProvenance: updates.judgeCanViewProvenance ?? current.submissionPolicy.judgeCanViewProvenance,
                    judgeCanViewArtifacts: updates.judgeCanViewArtifacts ?? current.submissionPolicy.judgeCanViewArtifacts,
                }),
    });
    return {
        ...current,
        submissionPolicy: nextPolicy,
    };
}
const initialScorecardForm = {
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
async function fetchJson(input, init, auth) {
    const resolvedInput = typeof input === 'string' && input.startsWith('/api') ? apiUrl(input) : input;
    const headers = {
        ...(init?.headers ?? {}),
        ...(auth ? buildAuthHeaders(auth.devSession, auth.accessToken) : {}),
    };
    const response = await fetch(resolvedInput, {
        ...init,
        headers,
    });
    const data = (await response.json());
    if (!response.ok) {
        const maybeMessage = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
            ? data.message
            : null;
        throw new Error(maybeMessage ?? `Request failed with ${response.status}`);
    }
    return data;
}
function useContests(devSession, accessToken) {
    const [includeDrafts, setIncludeDrafts] = useState(false);
    const [contests, setContests] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    async function loadContests() {
        try {
            setIsLoading(true);
            setError(null);
            const data = await fetchJson(includeDrafts ? '/api/contests?includeDrafts=true' : '/api/contests', undefined, devSession ? { devSession, accessToken: accessToken ?? null } : undefined);
            setContests(data.contests);
        }
        catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unknown error');
        }
        finally {
            setIsLoading(false);
        }
    }
    useEffect(() => {
        void loadContests();
    }, [accessToken, devSession, includeDrafts]);
    return { contests, isLoading, error, reload: loadContests, includeDrafts, setIncludeDrafts };
}
function buildContestPayload(form) {
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
function csvToList(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
const isProduction = siteModeConfig.mode === 'production';
function Shell({ title, subtitle, children, showHeroDescription = false }) {
    return (_jsxs("div", { className: "page-shell", children: [_jsxs("header", { className: "hero", children: [_jsx("div", { className: "hero-topline", children: _jsx("p", { className: "eyebrow", children: "Origin Draft" }) }), _jsx("h1", { children: title }), subtitle && _jsx("p", { className: "hero-copy", children: subtitle }), showHeroDescription && (_jsx("p", { className: "hero-copy", children: "Built for fair, transparent AI-assisted writing competitions." }))] }), children] }));
}
const devProfiles = [
    { label: 'Admin', icon: '🛡️', displayName: 'Admin User', email: 'admin@example.com', roles: ['platform-admin', 'organizer', 'judge', 'entrant'] },
    { label: 'Organizer', icon: '🏆', displayName: 'Organizer User', email: 'organizer@example.com', roles: ['organizer'] },
    { label: 'Judge', icon: '⚖️', displayName: 'Judge User', email: 'judge@example.com', roles: ['judge'] },
    { label: 'Entrant', icon: '✍️', displayName: 'Entrant User', email: 'entrant@example.com', roles: ['entrant'] },
];
function DevToolbar({ auth }) {
    if (!auth.config?.devBypassEnabled)
        return null;
    const activeRoles = auth.user?.roles ?? [];
    const activeProfile = devProfiles.find((p) => p.roles.length === activeRoles.length && p.roles.every((r) => activeRoles.includes(r)));
    const isVisitor = !auth.user;
    function switchTo(profile) {
        if (profile) {
            auth.updateDevSession({
                enabled: true,
                displayName: profile.displayName,
                email: profile.email,
                roles: [...profile.roles],
            });
        }
        else {
            auth.signOutDevSession();
        }
        void auth.reload();
    }
    return (_jsxs("div", { className: "dev-toolbar", children: [_jsx("span", { className: "dev-toolbar-label", children: "Dev" }), devProfiles.map((profile) => (_jsx("button", { type: "button", className: `dev-toolbar-btn${activeProfile === profile ? ' dev-toolbar-active' : ''}`, onClick: () => switchTo(profile), title: `${profile.label} (${profile.roles.join(', ')})`, children: _jsx("span", { className: "dev-toolbar-icon", children: profile.icon }) }, profile.label))), _jsx("button", { type: "button", className: `dev-toolbar-btn${isVisitor ? ' dev-toolbar-active' : ''}`, onClick: () => switchTo(null), title: "Visitor (signed out)", children: _jsx("span", { className: "dev-toolbar-icon", children: "\uD83D\uDC64" }) })] }));
}
function LoginPage() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const returnTo = searchParams.get('returnTo') || '/';
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mode, setMode] = useState('signin');
    const [formError, setFormError] = useState(null);
    const [signUpDone, setSignUpDone] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (auth.user) {
            navigate(returnTo, { replace: true });
        }
    }, [auth.user, navigate, returnTo]);
    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        setFormError(null);
        setBusy(true);
        try {
            if (mode === 'signup') {
                await auth.signUpWithEmail(email, password);
                setSignUpDone(true);
            }
            else {
                await auth.signInWithEmail(email, password);
                navigate(returnTo, { replace: true });
            }
        }
        catch (err) {
            setFormError(err instanceof Error ? err.message : 'Authentication failed');
        }
        finally {
            setBusy(false);
        }
    }, [auth, email, mode, navigate, password, returnTo]);
    if (signUpDone) {
        return (_jsx(Shell, { title: "Check your email", children: _jsxs("section", { className: "card card-accent", children: [_jsx("h2", { children: "Check your email" }), _jsxs("p", { children: ["We sent a confirmation link to ", _jsx("strong", { children: email }), ". Click the link to activate your account, then come back and sign in."] }), _jsx("button", { className: "button-primary", type: "button", onClick: () => { setSignUpDone(false); setMode('signin'); }, children: "Back to sign in" })] }) }));
    }
    return (_jsx(Shell, { title: mode === 'signin' ? 'Sign in' : 'Create account', children: _jsxs("section", { className: "card card-accent", children: [_jsx("h2", { children: mode === 'signin' ? 'Sign in' : 'Create account' }), formError ? _jsx("p", { className: "status status-error", children: formError }) : null, _jsxs("form", { onSubmit: (e) => void handleSubmit(e), style: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '24rem' }, children: [_jsxs("label", { children: ["Email", _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), required: true, autoComplete: "email" })] }), _jsxs("label", { children: ["Password", _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), required: true, minLength: 6, autoComplete: mode === 'signup' ? 'new-password' : 'current-password' })] }), _jsx("button", { className: "button-primary", type: "submit", disabled: busy, children: busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account' })] }), _jsx("p", { style: { marginTop: '1rem' }, children: mode === 'signin' ? (_jsxs(_Fragment, { children: ["Don't have an account? ", _jsx("button", { type: "button", className: "link-button", onClick: () => { setMode('signup'); setFormError(null); }, children: "Create one" })] })) : (_jsxs(_Fragment, { children: ["Already have an account? ", _jsx("button", { type: "button", className: "link-button", onClick: () => { setMode('signin'); setFormError(null); }, children: "Sign in" })] })) })] }) }));
}
function AuthCallbackPage() {
    const auth = useAuth();
    return (_jsx(Shell, { title: "Finishing sign-in", children: _jsxs("section", { className: "card card-accent", children: [_jsx("h2", { children: "Completing sign-in" }), auth.isLoading ? _jsx("p", { className: "status", children: "Exchanging the authorization code and restoring your session\u2026" }) : null, auth.error ? _jsxs("p", { className: "status status-error", children: ["Unable to complete sign-in: ", auth.error] }) : null, !auth.isLoading && !auth.error ? _jsx("p", { className: "status", children: "You\u2019re signed in. Redirecting you back to the app\u2026" }) : null, _jsxs("div", { className: "session-actions", children: [_jsx(Link, { className: "button-secondary inline-button", to: "/", children: "Return home" }), auth.error ? (_jsx("button", { className: "button-primary", type: "button", onClick: () => void auth.signIn(), children: "Try sign-in again" })) : null] })] }) }));
}
function RequireRoles({ roles, title, children, }) {
    const auth = useAuth();
    if (auth.isLoading) {
        return (_jsx(Shell, { title: title, children: _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Checking access" }), _jsx("p", { className: "status", children: "Validating your session and role membership\u2026" })] }) }));
    }
    if (!auth.user) {
        return (_jsx(Shell, { title: title, children: _jsxs("section", { className: "card empty-state", children: [_jsx("h2", { children: "Sign in to continue" }), _jsx("p", { children: "You need to be signed in to access this page." }), _jsx("button", { className: "button-primary", type: "button", onClick: () => void auth.signIn(), children: "Sign In" })] }) }));
    }
    if (!auth.user.roles.some((role) => roles.includes(role))) {
        return (_jsx(Shell, { title: title, children: _jsxs("section", { className: "card empty-state", children: [_jsx("h2", { children: "Access restricted" }), _jsx("p", { children: "Your account doesn't have the required role for this page." }), _jsx(Link, { className: "button-secondary inline-button", to: "/", children: "Back to home" })] }) }));
    }
    return _jsx(_Fragment, { children: children });
}
const stageLabels = {
    draft: 'Draft',
    'submission-open': 'Open',
    'judging-in-progress': 'Judging',
    announced: 'Results',
    finalized: 'Closed',
    published: 'Closed',
};
function stageLabel(stage) {
    return stageLabels[stage] ?? stage.replace(/-/g, ' ');
}
function HomePage() {
    const auth = useAuth();
    const { contests, isLoading, error } = useContests(auth.devSession, auth.accessToken);
    const [results, setResults] = useState([]);
    const [resultsError, setResultsError] = useState(null);
    const liveContests = useMemo(() => contests.filter((contest) => contest.stage === 'submission-open' || contest.stage === 'published'), [contests]);
    useEffect(() => {
        async function loadResults() {
            try {
                setResultsError(null);
                const data = await fetchJson('/api/results');
                setResults(data.results);
            }
            catch (loadError) {
                setResultsError(loadError instanceof Error ? loadError.message : 'Unknown error');
            }
        }
        void loadResults();
    }, []);
    return (_jsxs(Shell, { title: "Run AI-Assisted Writing Contests", showHeroDescription: true, children: [_jsxs("div", { className: "hero-actions", children: [_jsx("a", { href: "#contests", className: "button-primary inline-button", children: "Enter a Contest" }), _jsx(Link, { to: "/organizer", className: "button-secondary inline-button", children: "Run a Contest" })] }), _jsxs("section", { className: "trust-section", children: [_jsx("h2", { className: "trust-heading", children: "Why Origin Draft" }), _jsxs("div", { className: "trust-strip", children: [_jsxs("div", { className: "trust-item", children: [_jsx("span", { className: "trust-icon", children: "\uD83D\uDD12" }), _jsx("span", { children: "Blind judging" })] }), _jsxs("div", { className: "trust-item", children: [_jsx("span", { className: "trust-icon", children: "\uD83D\uDCDC" }), _jsx("span", { children: "Provenance tracking" })] }), _jsxs("div", { className: "trust-item", children: [_jsx("span", { className: "trust-icon", children: "\uD83D\uDCCB" }), _jsx("span", { children: "Structured scoring" })] }), _jsxs("div", { className: "trust-item", children: [_jsx("span", { className: "trust-icon", children: "\u2696\uFE0F" }), _jsx("span", { children: "AI disclosure rules" })] })] })] }), _jsxs("section", { className: "how-it-works section-divided", children: [_jsx("h2", { children: "How it works" }), _jsxs("div", { className: "grid three-up", children: [_jsxs("div", { className: "step-card card", children: [_jsx("span", { className: "step-number", children: "1" }), _jsx("h3", { children: "Create a contest" }), _jsx("p", { children: "Rules, rubrics, deadlines." })] }), _jsxs("div", { className: "step-card card", children: [_jsx("span", { className: "step-number", children: "2" }), _jsx("h3", { children: "Accept submissions" }), _jsx("p", { children: "Entries with provenance and consent." })] }), _jsxs("div", { className: "step-card card", children: [_jsx("span", { className: "step-number", children: "3" }), _jsx("h3", { children: "Judge & publish" }), _jsx("p", { children: "Blind scoring and results." })] })] })] }), _jsxs("section", { className: "grid three-up section-divided", children: [_jsxs(Link, { to: "/entrant", className: "role-card card", children: [_jsx("span", { className: "role-icon", children: "\u270D\uFE0F" }), _jsx("h3", { children: "Enter a Contest" }), _jsx("p", { children: "Submit writing and track results" }), _jsxs("span", { className: "role-cta", children: ["Enter ", _jsx("span", { className: "cta-arrow", children: "\u2192" })] })] }), _jsxs(Link, { to: "/judge", className: "role-card card", children: [_jsx("span", { className: "role-icon", children: "\u2696\uFE0F" }), _jsx("h3", { children: "Judge Submissions" }), _jsx("p", { children: "Score blinded entries" }), _jsxs("span", { className: "role-cta", children: ["Judge ", _jsx("span", { className: "cta-arrow", children: "\u2192" })] })] }), _jsxs(Link, { to: "/organizer", className: "role-card card", children: [_jsx("span", { className: "role-icon", children: "\uD83C\uDFC6" }), _jsx("h3", { children: "Run a Contest" }), _jsx("p", { children: "Create and manage competitions" }), _jsxs("span", { className: "role-cta", children: ["Organize ", _jsx("span", { className: "cta-arrow", children: "\u2192" })] })] })] }), _jsxs("section", { id: "contests", className: "section-divided", children: [_jsx("div", { className: "section-header", children: _jsx("h2", { children: "Active Contests" }) }), isLoading ? _jsx("p", { className: "status", children: "Loading contests\\u2026" }) : null, error && !isLoading ? (_jsxs("article", { className: "card empty-state", children: [_jsx("h3", { children: "No contests yet" }), _jsx("p", { children: "Be the first to launch one." }), _jsx(Link, { className: "button-primary inline-button", to: "/organizer", children: "Create First Contest" })] })) : null, !isLoading && !error && liveContests.length === 0 ? (_jsxs("article", { className: "card empty-state", children: [_jsx("h3", { children: "No contests yet" }), _jsx("p", { children: "Be the first to launch one." }), _jsx(Link, { className: "button-primary inline-button", to: "/organizer", children: "Create First Contest" })] })) : null, _jsx("div", { className: "grid contest-grid", children: liveContests.map((contest) => (_jsxs("article", { className: "card contest-card", children: [_jsx("div", { className: "contest-card-header", children: _jsx("span", { className: `stage-pill stage-${contest.stage}`, children: stageLabel(contest.stage) }) }), _jsx("h3", { children: contest.title }), _jsx("p", { children: contest.tagline }), _jsxs("dl", { className: "meta-grid", children: [_jsxs("div", { children: [_jsx("dt", { children: "Deadline" }), _jsx("dd", { children: new Date(contest.closesAt).toLocaleDateString() })] }), _jsxs("div", { children: [_jsx("dt", { children: "Max words" }), _jsx("dd", { children: contest.maxWords.toLocaleString() })] }), _jsxs("div", { children: [_jsx("dt", { children: "Teams" }), _jsx("dd", { children: contest.allowsTeams ? 'Allowed' : 'Solo only' })] }), _jsxs("div", { children: [_jsx("dt", { children: "AI policy" }), _jsx("dd", { children: contest.aiDisclosureMode.replace(/-/g, ' ') })] })] }), auth.user ? (_jsx(Link, { className: "button-primary inline-button", to: "/entrant", children: "Enter" })) : (_jsx("button", { className: "button-primary", type: "button", onClick: () => void auth.signIn(), children: "Sign in to enter" }))] }, contest.id))) })] }), _jsxs("section", { children: [_jsx("div", { className: "section-header", children: _jsx("h2", { children: "Results" }) }), resultsError && (_jsxs("article", { className: "card empty-state", children: [_jsx("h3", { children: "No results yet" }), _jsx("p", { children: "Winners will appear here. Run a contest to publish your first results." })] })), !resultsError && results.length === 0 ? (_jsxs("article", { className: "card empty-state", children: [_jsx("h3", { children: "No results yet" }), _jsx("p", { children: "Winners will appear here. Run a contest to publish your first results." })] })) : null, _jsx("div", { className: "grid contest-grid", children: results.map((result) => (_jsxs("article", { className: "card result-card", children: [_jsx("h3", { children: result.contest.title }), result.winners.length > 0 && (_jsxs("div", { className: "result-section", children: [_jsx("h4", { children: "\\ud83e\\udd47 Winners" }), _jsx("ul", { className: "result-list", children: result.winners.map((w) => (_jsxs("li", { children: [_jsx("strong", { children: w.title }), _jsx("span", { children: w.authors.join(', ') })] }, w.entryId))) })] })), result.finalists.length > 0 && (_jsxs("div", { className: "result-section", children: [_jsx("h4", { children: "\\ud83e\\udd48 Finalists" }), _jsx("ul", { className: "result-list", children: result.finalists.map((f) => (_jsxs("li", { children: [_jsx("strong", { children: f.title }), _jsx("span", { children: f.authors.join(', ') })] }, f.entryId))) })] })), _jsx(Link, { className: "text-link", to: "/results", children: "View full results \\u2192" })] }, result.contest.id))) })] }), _jsxs("footer", { className: "site-footer", children: [_jsx("p", { className: "footer-trust", children: "AI-assisted contests with transparent judging and structured evaluation." }), _jsxs("div", { className: "footer-links", children: [_jsx(Link, { to: "/terms", children: "Terms" }), _jsx(Link, { to: "/privacy", children: "Privacy" }), _jsx(Link, { to: "/resources", children: "About" }), _jsx(Link, { to: "/resources", children: "Resources" }), _jsx("a", { href: "mailto:hello@origindraft.com", children: "Contact" })] }), _jsxs("p", { children: ["\u00A9 ", new Date().getFullYear(), " Origin Draft \u00B7 Launch and run writing contests in minutes."] })] })] }));
}
function ResourcesPage() {
    return (_jsxs(Shell, { title: "Resources", subtitle: "The open specifications and tools behind Origin Draft.", children: [_jsxs("section", { className: "card card-accent", children: [_jsx("h2", { children: "About Origin Draft" }), _jsx("p", { children: "Origin Draft is a platform for running AI-assisted writing contests with structured provenance tracking, blind judging, and transparent process disclosure. It is built on a family of open specifications designed to bring rigor and reproducibility to creative AI workflows." })] }), _jsxs("section", { className: "grid two-up", children: [_jsxs("article", { className: "card", children: [_jsx("h2", { children: "CAP \u2014 Canonical Artifact Protocol" }), _jsx("p", { children: "The domain-agnostic substrate for decomposing any artifact into epistemically-separated canonical structures: observables, structure, and interpretations. CAP guarantees lossless round-trip fidelity across tools and formats." }), _jsx("p", { children: _jsx("a", { className: "text-link", href: "https://github.com/origin-draft/sip-protocol", target: "_blank", rel: "noopener noreferrer", children: "Specification on GitHub \u2197" }) })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "CAP Narrative Profile" }), _jsx("p", { children: "The fiction-specific layer built on CAP. Registers vocabulary for characters, scenes, beats, narrative voice, and narratological theory \u2014 everything needed to represent prose fiction in structured, machine-readable form." }), _jsx("p", { children: _jsx("a", { className: "text-link", href: "https://github.com/origin-draft/gbr-protocol", target: "_blank", rel: "noopener noreferrer", children: "Profile specification on GitHub \u2197" }) })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Grimoire \u2014 Writing System" }), _jsx("p", { children: "An author-led, AI-assisted writing system with fill-in templates grounded in literary theory. Grimoire bridges the gap between creative planning and structured AI context across concept, character, plot, drafting, and revision phases." }), _jsx("p", { className: "pill-row", children: _jsx("span", { className: "pill", children: "Not yet open-sourced" }) })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "CAP Datasets" }), _jsx("p", { children: "Training and evaluation data for the CAP Narrative Profile. Includes public-domain annotations, synthetic examples, and hand-annotated records for validating the profile and producing bidirectional scene-to-prose model pairs." }), _jsx("p", { children: _jsx("a", { className: "text-link", href: "https://github.com/origin-draft/cap-datasets", target: "_blank", rel: "noopener noreferrer", children: "Dataset repository on GitHub \u2197" }) })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "How it fits together" }), _jsx("p", { children: "Grimoire produces the author-facing planning documents and AI prompts. Those documents generate training data captured in CAP Datasets, which validates against the Narrative Profile specification. The Narrative Profile extends the core CAP protocol. Origin Draft uses these standards to power contest provenance tracking, submission analysis, and structured judging workflows." }), _jsx("div", { className: "resource-diagram", children: _jsxs("p", { children: [_jsx("strong", { children: "Grimoire" }), " (writing system) \u2192 ", _jsx("strong", { children: "CAP Datasets" }), " (training corpus) \u2192 ", _jsx("strong", { children: "CAP Narrative Profile" }), " (domain vocabulary) \u2192", ' ', _jsx("strong", { children: "CAP Core" }), " (epistemic substrate)"] }) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Community & contributing" }), _jsx("p", { children: "Origin Draft and its specifications are developed in the open. Contributions, feedback, and discussion are welcome." }), _jsx("p", { children: _jsx("a", { className: "text-link", href: "https://github.com/origin-draft", target: "_blank", rel: "noopener noreferrer", children: "Origin Draft on GitHub \u2197" }) })] })] }));
}
function TermsPage() {
    return (_jsxs(Shell, { title: "Terms of Service", children: [_jsxs("section", { className: "card card-accent", children: [_jsx("h2", { children: "Terms of Service" }), _jsxs("p", { className: "status", children: ["Last updated: ", new Date().getFullYear()] }), _jsx("p", { children: "Origin Draft is currently in early access. By using this platform you agree to participate in good faith and to submit only work you have the right to enter. Full terms will be published before the platform's public launch." })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Key Points" }), _jsxs("ul", { children: [_jsx("li", { children: "You retain ownership of all work you submit." }), _jsx("li", { children: "Submissions are evaluated by human judges; AI tooling is used for analysis, not selection." }), _jsx("li", { children: "AI usage in your work must be disclosed as part of the submission process." }), _jsx("li", { children: "We do not sell your data to third parties." })] }), _jsxs("p", { children: ["Questions? ", _jsx("a", { className: "text-link", href: "mailto:hello@origindraft.com", children: "Contact us" }), "."] })] })] }));
}
function PrivacyPage() {
    return (_jsxs(Shell, { title: "Privacy Policy", children: [_jsxs("section", { className: "card card-accent", children: [_jsx("h2", { children: "Privacy Policy" }), _jsxs("p", { className: "status", children: ["Last updated: ", new Date().getFullYear()] }), _jsx("p", { children: "Origin Draft collects only the information necessary to operate writing contests. Full privacy policy details will be published before the platform's public launch." })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "What We Collect" }), _jsxs("ul", { children: [_jsx("li", { children: "Account credentials managed by our authentication provider (Supabase Auth)." }), _jsx("li", { children: "Contest submissions and associated metadata you provide." }), _jsx("li", { children: "Standard server logs for security and debugging purposes." })] }), _jsx("h2", { children: "What We Don't Do" }), _jsxs("ul", { children: [_jsx("li", { children: "We do not sell or share your personal data with third parties." }), _jsx("li", { children: "We do not use submitted manuscripts to train AI models without explicit consent." })] }), _jsxs("p", { children: ["Questions? ", _jsx("a", { className: "text-link", href: "mailto:hello@origindraft.com", children: "Contact us" }), "."] })] })] }));
}
function ResultsPage() {
    const [results, setResults] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        async function loadResults() {
            try {
                setIsLoading(true);
                setError(null);
                const data = await fetchJson('/api/results');
                setResults(data.results);
            }
            catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : 'Unknown error');
            }
            finally {
                setIsLoading(false);
            }
        }
        void loadResults();
    }, []);
    return (_jsxs(Shell, { title: "Published Results", subtitle: "Winners, finalists, and their stories.", children: [isLoading ? _jsx("p", { className: "status", children: "Loading results\\u2026" }) : null, error && !isLoading ? (_jsxs("article", { className: "card empty-state", children: [_jsx("h3", { children: "No published results yet" }), _jsx("p", { children: "Published results will appear here once contests are completed." })] })) : null, !isLoading && !error && results.length === 0 ? (_jsxs("article", { className: "card empty-state", children: [_jsx("h3", { children: "No published results yet" }), _jsx("p", { children: "Published results will appear here once contests are completed." })] })) : null, _jsx("section", { className: "grid contest-grid", children: results.map((result) => (_jsxs("article", { className: "card result-card", children: [_jsxs("h2", { children: ["\\ud83c\\udfc6 ", result.contest.title] }), _jsx("p", { children: result.contest.tagline }), _jsxs("div", { className: "pill-row", children: [_jsxs("span", { className: "pill", children: [result.winners.length, " winner", result.winners.length === 1 ? '' : 's'] }), _jsxs("span", { className: "pill", children: [result.finalists.length, " finalist", result.finalists.length === 1 ? '' : 's'] })] }), result.winners.length > 0 && (_jsxs("div", { className: "result-section", children: [_jsx("h3", { children: "\\ud83e\\udd47 Winners" }), _jsx("ul", { className: "result-list", children: result.winners.map((winner) => (_jsxs("li", { children: [_jsx("strong", { children: winner.title }), _jsx("span", { children: winner.authors.join(', ') }), _jsx(Link, { className: "text-link", to: `/read/${winner.entryId}`, children: "Read entry \\u2192" })] }, winner.entryId))) })] })), result.finalists.length > 0 && (_jsxs("div", { className: "result-section", children: [_jsx("h3", { children: "\\ud83e\\udd48 Finalists" }), _jsx("ul", { className: "result-list", children: result.finalists.map((finalist) => (_jsxs("li", { children: [_jsx("strong", { children: finalist.title }), _jsx("span", { children: finalist.authors.join(', ') }), _jsx(Link, { className: "text-link", to: `/read/${finalist.entryId}`, children: "Read entry \\u2192" })] }, finalist.entryId))) })] }))] }, result.contest.id))) })] }));
}
function SubmissionDetailPage() {
    const auth = useAuth();
    const { entryId = '' } = useParams();
    const [detail, setDetail] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [artifactType, setArtifactType] = useState('supporting-note');
    const [artifactFile, setArtifactFile] = useState(null);
    const [artifactMessage, setArtifactMessage] = useState(null);
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
            const data = await fetchJson(`/api/submissions/${entryId}`, undefined, auth);
            setDetail(data);
        }
        catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unknown error');
        }
        finally {
            setIsLoading(false);
        }
    }
    useEffect(() => {
        async function loadEntryDetail() {
            try {
                await loadDetail();
            }
            catch {
                // handled in loadDetail
            }
        }
        void loadEntryDetail();
    }, [auth.accessToken, auth.devSession, entryId]);
    async function handleArtifactUpload(event) {
        event.preventDefault();
        if (!artifactFile) {
            setArtifactMessage('Choose a file before uploading.');
            return;
        }
        const formData = new FormData();
        formData.append('file', artifactFile);
        try {
            setArtifactMessage(null);
            const response = await fetch(apiUrl(`/api/submissions/${entryId}/artifacts?artifactType=${encodeURIComponent(artifactType)}`), {
                method: 'POST',
                headers: buildAuthHeaders(auth.devSession, auth.accessToken),
                body: formData,
            });
            const data = (await response.json());
            if (!response.ok) {
                throw new Error(typeof data === 'object' && data && 'message' in data && typeof data.message === 'string' ? data.message : `Upload failed with ${response.status}`);
            }
            setArtifactMessage('Artifact uploaded.');
            setArtifactFile(null);
            await loadDetail();
        }
        catch (uploadError) {
            setArtifactMessage(uploadError instanceof Error ? uploadError.message : 'Unable to upload artifact');
        }
    }
    return (_jsxs(Shell, { title: "Submission detail", children: [isLoading ? _jsx("p", { className: "status", children: "Loading submission\u2026" }) : null, error ? _jsxs("p", { className: "status status-error", children: ["Unable to load submission: ", error] }) : null, detail ? (_jsxs(_Fragment, { children: [_jsxs("section", { className: "card manuscript-card", children: [_jsx("p", { className: "contest-stage", children: detail.entry.status.replace('-', ' ') }), _jsx("h2", { children: detail.entry.title }), _jsxs("p", { children: [detail.contest.title, " \u00B7 ", detail.access.canViewAuthorIdentity ? detail.entry.authors.join(', ') : 'Anonymous entrant'] }), _jsxs("div", { className: "pill-row", children: [_jsxs("span", { className: "pill", children: [detail.entry.wordCount.toLocaleString(), " words"] }), _jsxs("span", { className: "pill", children: [detail.assignments.length, " assignment", detail.assignments.length === 1 ? '' : 's'] })] }), detail.access.canViewAiDisclosure ? (_jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "AI disclosure" }), _jsx("p", { children: detail.entry.aiStatement })] })) : (_jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "AI disclosure" }), _jsx("p", { children: "Hidden for judges by contest policy." })] })), detail.access.canViewProvenance ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid two-up provenance-grid", children: [_jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Scene cards" }), _jsx("p", { children: detail.provenance.sceneCardsText || 'No scene cards submitted.' })] }), _jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Steps to reproduce" }), _jsx("p", { children: detail.provenance.reproductionStepsText || 'No reproduction notes submitted.' })] })] }), _jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Prompt history" }), _jsx("p", { children: detail.provenance.promptHistoryText || 'No prompt history submitted.' })] }), _jsxs("div", { className: "grid two-up provenance-grid", children: [_jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Consent profile" }), _jsxs("ul", { children: [_jsxs("li", { children: ["Research use: ", detail.consent.allowResearchUse ? 'allowed' : 'not allowed'] }), _jsxs("li", { children: ["Training use: ", detail.consent.allowTrainingUse ? 'allowed' : 'not allowed'] }), _jsxs("li", { children: ["Anonymization required: ", detail.consent.requireAnonymization ? 'yes' : 'no'] }), _jsxs("li", { children: ["Public reading: ", detail.consent.allowPublicReading ? 'allowed' : 'not allowed'] })] })] }), _jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Consent timestamp" }), _jsx("p", { children: detail.consent.agreedAt ? new Date(detail.consent.agreedAt).toLocaleString() : 'Not available' })] })] })] })) : (_jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Process provenance" }), _jsx("p", { children: "Hidden for judges by contest policy." })] })), _jsx("article", { className: "manuscript-body", children: detail.entry.manuscriptText.split('\n\n').map((paragraph, index) => (_jsx("p", { children: paragraph }, `${detail.entry.id}-${index}`))) })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Review trail" }), _jsxs("div", { className: "grid contest-grid", children: [detail.assignments.length === 0 ? (_jsx("article", { className: "contest-list-row", children: _jsxs("div", { children: [_jsx("h3", { children: "No assignments yet" }), _jsx("p", { children: "This entry has not entered the judging queue." })] }) })) : null, detail.assignments.map((assignment) => (_jsxs("article", { className: "contest-list-row", children: [_jsxs("div", { children: [_jsx("h3", { children: assignment.assignedJudge }), _jsx("p", { children: assignment.overallComment ?? 'No overall comment submitted yet.' })] }), _jsxs("div", { className: "mini-meta", children: [_jsx("span", { children: assignment.status }), _jsx("span", { children: assignment.recommendation ?? 'pending' }), _jsx("span", { children: assignment.submittedAt ? new Date(assignment.submittedAt).toLocaleDateString() : 'not submitted' })] })] }, assignment.id)))] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Artifacts" }), detail.access.canViewArtifacts ? (_jsxs(_Fragment, { children: [_jsxs("p", { children: ["Allowed artifact types for this contest: ", allowedArtifactTypes.join(', '), "."] }), canUploadArtifacts ? (_jsxs("form", { className: "stack-form", onSubmit: handleArtifactUpload, children: [_jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { children: "Artifact type" }), _jsx("select", { value: artifactType, onChange: (event) => setArtifactType(event.target.value), children: allowedArtifactTypes.map((type) => (_jsx("option", { value: type, children: type }, type))) })] }), _jsxs("label", { children: [_jsx("span", { children: "File" }), _jsx("input", { type: "file", onChange: (event) => setArtifactFile(event.target.files?.[0] ?? null) })] })] }), _jsx("button", { className: "button-primary", type: "submit", children: "Upload artifact" }), artifactMessage ? _jsx("p", { className: "status", children: artifactMessage }) : null] })) : null, _jsxs("div", { className: "grid contest-grid", children: [detail.artifacts.length === 0 ? (_jsx("article", { className: "contest-list-row", children: _jsxs("div", { children: [_jsx("h3", { children: "No artifacts yet" }), _jsx("p", { children: "This submission has no uploaded files yet." })] }) })) : null, detail.artifacts.map((artifact) => (_jsxs("article", { className: "contest-list-row", children: [_jsxs("div", { children: [_jsx("h3", { children: artifact.originalFilename }), _jsx("p", { children: artifact.artifactType }), _jsx("a", { className: "text-link", href: apiUrl(`/api/submissions/${detail.entry.id}/artifacts/${artifact.id}/download`), children: "Download artifact" })] }), _jsxs("div", { className: "mini-meta", children: [_jsx("span", { children: artifact.mimeType }), _jsxs("span", { children: [(artifact.sizeBytes / 1024).toFixed(1), " KB"] }), _jsx("span", { children: new Date(artifact.uploadedAt).toLocaleDateString() })] })] }, artifact.id)))] })] })) : (_jsx("p", { children: "Hidden for judges by contest policy." }))] })] })) : null] }));
}
function ContestPreviewPage() {
    const auth = useAuth();
    const { contestId = '' } = useParams();
    const [detail, setDetail] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        async function loadContestPreview() {
            try {
                setIsLoading(true);
                setError(null);
                const data = await fetchJson(`/api/contests/${contestId}?includeDrafts=true`, undefined, auth);
                setDetail(data);
            }
            catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : 'Unknown error');
            }
            finally {
                setIsLoading(false);
            }
        }
        void loadContestPreview();
    }, [auth.accessToken, auth.devSession, contestId]);
    return (_jsxs(Shell, { title: detail ? `${detail.contest.title} preview` : 'Contest preview', children: [!auth.user || !auth.user.roles.some((role) => ['organizer', 'platform-admin'].includes(role)) ? (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "Organizer access required" }), _jsx("p", { children: "Draft previews are only visible to organizers and platform admins." })] })) : null, isLoading ? _jsx("p", { className: "status", children: "Loading preview\u2026" }) : null, error ? _jsxs("p", { className: "status status-error", children: ["Unable to load contest preview: ", error] }) : null, detail ? (_jsxs(_Fragment, { children: [_jsxs("section", { className: "card card-accent", children: [_jsx("p", { className: "contest-stage", children: detail.contest.stage.replace('-', ' ') }), _jsx("h2", { children: detail.contest.title }), _jsx("p", { children: detail.contest.tagline }), detail.contest.stage === 'draft' ? (_jsx("p", { className: "status", children: "Draft preview only \u2014 this contest remains hidden from public listing until you move it out of draft." })) : null, _jsxs("div", { className: "pill-row", children: [_jsxs("span", { className: "pill", children: [detail.contest.submissionPolicy.minWords, "\u2013", detail.contest.maxWords, " words"] }), _jsx("span", { className: "pill", children: detail.contest.allowsTeams ? 'Teams allowed' : 'Solo only' }), _jsx("span", { className: "pill", children: detail.contest.aiDisclosureMode }), _jsxs("span", { className: "pill", children: [detail.relatedEntries.length, " submission", detail.relatedEntries.length === 1 ? '' : 's'] })] })] }), _jsxs("section", { className: "grid two-up", children: [_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Submission criteria" }), _jsxs("ul", { children: [_jsxs("li", { children: ["Minimum words: ", detail.contest.submissionPolicy.minWords] }), _jsxs("li", { children: ["Maximum words: ", detail.contest.maxWords] }), _jsxs("li", { children: ["Max submissions per entrant: ", detail.contest.submissionPolicy.maxSubmissionsPerEntrant] }), _jsxs("li", { children: ["Max submissions per team: ", detail.contest.submissionPolicy.maxSubmissionsPerTeam] }), _jsxs("li", { children: ["Max artifacts per submission: ", detail.contest.submissionPolicy.maxArtifactsPerSubmission] }), _jsxs("li", { children: ["Allowed artifacts: ", detail.contest.submissionPolicy.allowedArtifactTypes.join(', ')] })] })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Disclosure and judging rules" }), _jsxs("ul", { children: [_jsxs("li", { children: ["Scene cards: ", detail.contest.submissionPolicy.requireSceneCards ? 'required' : 'optional'] }), _jsxs("li", { children: ["Steps to reproduce: ", detail.contest.submissionPolicy.requireReproductionSteps ? 'required' : 'optional'] }), _jsxs("li", { children: ["Prompt history: ", detail.contest.submissionPolicy.requirePromptHistory ? 'required' : 'optional'] }), _jsxs("li", { children: ["Public reading opt-in: ", detail.contest.submissionPolicy.allowPublicReadingOptIn ? 'available' : 'disabled'] }), _jsxs("li", { children: ["Judge can view identity: ", detail.contest.submissionPolicy.judgeCanViewAuthorIdentity ? 'yes' : 'no'] }), _jsxs("li", { children: ["Judge can view AI disclosure: ", detail.contest.submissionPolicy.judgeCanViewAiDisclosure ? 'yes' : 'no'] }), _jsxs("li", { children: ["Judge can view provenance: ", detail.contest.submissionPolicy.judgeCanViewProvenance ? 'yes' : 'no'] }), _jsxs("li", { children: ["Judge can view artifacts: ", detail.contest.submissionPolicy.judgeCanViewArtifacts ? 'yes' : 'no'] })] })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Public-facing summary" }), _jsxs("p", { children: ["Categories: ", detail.contest.categories.join(', ')] }), _jsxs("p", { children: ["Judging focus: ", detail.contest.judgingFocus.join(', ')] }), _jsxs("p", { children: ["Timeline: opens ", new Date(detail.contest.opensAt).toLocaleString(), " \u00B7 closes ", new Date(detail.contest.closesAt).toLocaleString()] })] })] })) : null] }));
}
function PublicReadingPage() {
    const { entryId = '' } = useParams();
    const [entry, setEntry] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        async function loadEntry() {
            try {
                setIsLoading(true);
                setError(null);
                const data = await fetchJson(`/api/public/entries/${entryId}`);
                setEntry(data.entry);
            }
            catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : 'Unknown error');
            }
            finally {
                setIsLoading(false);
            }
        }
        void loadEntry();
    }, [entryId]);
    return (_jsxs(Shell, { title: "Public reading page", children: [isLoading ? _jsx("p", { className: "status", children: "Loading entry\u2026" }) : null, error ? _jsxs("p", { className: "status status-error", children: ["Unable to load published entry: ", error] }) : null, entry ? (_jsxs("section", { className: "card manuscript-card", children: [_jsx("p", { className: "contest-stage", children: entry.placement }), _jsx("h2", { children: entry.title }), _jsxs("p", { children: [entry.contestTitle, " \u00B7 ", entry.authors.join(', ')] }), _jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "AI disclosure" }), _jsx("p", { children: entry.aiStatement })] }), _jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Public reading rights" }), _jsx("p", { children: entry.consent.allowPublicReading ? 'Approved for public reading.' : 'Public reading not permitted.' })] }), _jsx("article", { className: "manuscript-body", children: entry.manuscriptText.split('\n\n').map((paragraph, index) => (_jsx("p", { children: paragraph }, `${entry.entryId}-${index}`))) })] })) : null] }));
}
function EntrantPage() {
    const auth = useAuth();
    const { contests, isLoading: isContestLoading, error: contestError } = useContests(auth.devSession, auth.accessToken);
    const [teams, setTeams] = useState([]);
    const [submissions, setSubmissions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saveMessage, setSaveMessage] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [form, setForm] = useState(initialSubmissionForm);
    const selectedContest = useMemo(() => contests.find((contest) => contest.id === form.contestId) ?? null, [contests, form.contestId]);
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
            const teamsData = (await teamsResponse.json());
            const submissionsData = (await submissionsResponse.json());
            setTeams(teamsData.teams);
            setSubmissions(submissionsData.submissions);
        }
        catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unknown error');
        }
        finally {
            setIsLoading(false);
        }
    }
    useEffect(() => {
        void loadEntrantData();
    }, [auth.accessToken, auth.devSession]);
    async function handleSubmit(event) {
        event.preventDefault();
        setIsSaving(true);
        setSaveMessage(null);
        const payload = {
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
            const data = (await response.json());
            if (!response.ok) {
                throw new Error('message' in data ? data.message : `Submission failed with ${response.status}`);
            }
            if (!('submission' in data)) {
                throw new Error('Submission response did not include the created submission payload.');
            }
            setSaveMessage(`Saved ${data.submission.title}.`);
            setForm((current) => ({ ...current, title: 'Another impossible little masterpiece' }));
            await loadEntrantData();
        }
        catch (submitError) {
            setSaveMessage(submitError instanceof Error ? submitError.message : 'Unable to save submission');
        }
        finally {
            setIsSaving(false);
        }
    }
    return (_jsxs(Shell, { title: "Entrant portal", children: [_jsxs("section", { className: "grid two-up", children: [!auth.user || !auth.user.roles.some((role) => ['entrant', 'organizer', 'platform-admin'].includes(role)) ? (_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Entrant access required" }), _jsx("p", { children: "Sign in as an entrant, organizer, or platform admin to create and view submissions." })] })) : null, _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Submission flow" }), _jsxs("ol", { children: [_jsx("li", { children: "Create or join a writing team." }), _jsx("li", { children: "Select a contest and verify eligibility." }), _jsx("li", { children: "Upload the manuscript and complete the contest-specific AI disclosure." }), _jsx("li", { children: "Track the submission from draft to judging and results." })] }), _jsx("h3", { children: "Available contests" }), isContestLoading ? _jsx("p", { className: "status", children: "Loading contests\u2026" }) : null, contestError ? _jsx("p", { className: "status status-error", children: contestError }) : null, _jsx("ul", { children: contests.map((contest) => (_jsxs("li", { children: [contest.title, " \u2014 ", contest.maxWords.toLocaleString(), " words max \u2014 ", contest.aiDisclosureMode] }, contest.id))) })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Create a submission" }), selectedContest ? (_jsxs("div", { className: "meta-panel", children: [_jsxs("h3", { children: [selectedContest.title, " requirements"] }), _jsxs("ul", { children: [_jsxs("li", { children: ["Scene cards: ", selectedContest.submissionPolicy.requireSceneCards ? 'required' : 'optional'] }), _jsxs("li", { children: ["Steps to reproduce: ", selectedContest.submissionPolicy.requireReproductionSteps ? 'required' : 'optional'] }), _jsxs("li", { children: ["Prompt history: ", selectedContest.submissionPolicy.requirePromptHistory ? 'required' : 'optional'] }), _jsxs("li", { children: ["Minimum words: ", selectedContest.submissionPolicy.minWords] }), _jsxs("li", { children: ["Maximum submissions per entrant: ", selectedContest.submissionPolicy.maxSubmissionsPerEntrant] }), _jsxs("li", { children: ["Maximum submissions per team: ", selectedContest.submissionPolicy.maxSubmissionsPerTeam] }), _jsxs("li", { children: ["Public reading opt-in: ", selectedContest.submissionPolicy.allowPublicReadingOptIn ? 'available' : 'disabled for this contest'] }), _jsxs("li", { children: ["Maximum artifacts per submission: ", selectedContest.submissionPolicy.maxArtifactsPerSubmission] }), _jsxs("li", { children: ["Artifact types later allowed: ", selectedContest.submissionPolicy.allowedArtifactTypes.join(', ')] })] })] })) : null, _jsxs("form", { className: "stack-form", onSubmit: handleSubmit, children: [_jsxs("label", { children: [_jsx("span", { children: "Title" }), _jsx("input", { value: form.title, onChange: (event) => setForm((current) => ({ ...current, title: event.target.value })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Contest" }), _jsx("select", { value: form.contestId, onChange: (event) => setForm((current) => ({ ...current, contestId: event.target.value })), children: contests.map((contest) => (_jsx("option", { value: contest.id, children: contest.title }, contest.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "Team" }), _jsxs("select", { value: form.teamId ?? '', onChange: (event) => setForm((current) => ({ ...current, teamId: event.target.value || null })), disabled: selectedContest ? !selectedContest.allowsTeams : false, children: [_jsx("option", { value: "", children: "Solo submission" }), teams.map((team) => (_jsx("option", { value: team.id, children: team.name }, team.id)))] })] }), _jsxs("label", { children: [_jsx("span", { children: "Authors" }), _jsx("input", { value: form.authorsText, onChange: (event) => setForm((current) => ({ ...current, authorsText: event.target.value })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Word count" }), _jsx("input", { type: "number", min: selectedContest?.submissionPolicy.minWords ?? 1, max: selectedContest?.maxWords, value: form.wordCount, onChange: (event) => setForm((current) => ({ ...current, wordCount: Number(event.target.value) })) })] }), _jsxs("label", { children: [_jsx("span", { children: "AI disclosure" }), _jsx("textarea", { value: form.aiStatement, onChange: (event) => setForm((current) => ({ ...current, aiStatement: event.target.value })), rows: 4 })] }), _jsxs("label", { children: [_jsx("span", { children: "Manuscript text" }), _jsx("textarea", { value: form.manuscriptText, onChange: (event) => setForm((current) => ({ ...current, manuscriptText: event.target.value })), rows: 10 })] }), _jsxs("label", { children: [_jsxs("span", { children: ["Scene cards", selectedContest?.submissionPolicy.requireSceneCards ? ' *' : ''] }), _jsx("textarea", { required: selectedContest?.submissionPolicy.requireSceneCards, value: form.provenance.sceneCardsText, onChange: (event) => setForm((current) => ({
                                                    ...current,
                                                    provenance: { ...current.provenance, sceneCardsText: event.target.value },
                                                })), rows: 4 })] }), _jsxs("label", { children: [_jsxs("span", { children: ["Steps to reproduce", selectedContest?.submissionPolicy.requireReproductionSteps ? ' *' : ''] }), _jsx("textarea", { required: selectedContest?.submissionPolicy.requireReproductionSteps, value: form.provenance.reproductionStepsText, onChange: (event) => setForm((current) => ({
                                                    ...current,
                                                    provenance: { ...current.provenance, reproductionStepsText: event.target.value },
                                                })), rows: 4 })] }), _jsxs("label", { children: [_jsxs("span", { children: ["Prompt history", selectedContest?.submissionPolicy.requirePromptHistory ? ' *' : ''] }), _jsx("textarea", { required: selectedContest?.submissionPolicy.requirePromptHistory, value: form.provenance.promptHistoryText, onChange: (event) => setForm((current) => ({
                                                    ...current,
                                                    provenance: { ...current.provenance, promptHistoryText: event.target.value },
                                                })), rows: 6 })] }), _jsxs("div", { className: "consent-grid", children: [_jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.consent.allowResearchUse, onChange: (event) => setForm((current) => ({
                                                            ...current,
                                                            consent: { ...current.consent, allowResearchUse: event.target.checked },
                                                        })) }), _jsx("span", { children: "Allow research use" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.consent.allowTrainingUse, onChange: (event) => setForm((current) => ({
                                                            ...current,
                                                            consent: { ...current.consent, allowTrainingUse: event.target.checked },
                                                        })) }), _jsx("span", { children: "Allow training use" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.consent.requireAnonymization, onChange: (event) => setForm((current) => ({
                                                            ...current,
                                                            consent: { ...current.consent, requireAnonymization: event.target.checked },
                                                        })) }), _jsx("span", { children: "Require anonymization before reuse" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.consent.allowPublicReading, disabled: selectedContest ? !selectedContest.submissionPolicy.allowPublicReadingOptIn : false, onChange: (event) => setForm((current) => ({
                                                            ...current,
                                                            consent: { ...current.consent, allowPublicReading: event.target.checked },
                                                        })) }), _jsx("span", { children: selectedContest?.submissionPolicy.allowPublicReadingOptIn
                                                            ? 'Allow public reading if selected'
                                                            : 'Public reading opt-in disabled for this contest' })] })] }), _jsx("button", { className: "button-primary", type: "submit", disabled: isSaving, children: isSaving ? 'Saving…' : 'Save submission' }), saveMessage ? _jsx("p", { className: "status", children: saveMessage }) : null, error ? _jsx("p", { className: "status status-error", children: error }) : null] })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Your submission queue" }), isLoading ? _jsx("p", { className: "status", children: "Loading submissions\u2026" }) : null, _jsx("div", { className: "grid contest-grid", children: submissions.map((submission) => (_jsxs("article", { className: "contest-list-row", children: [_jsxs("div", { children: [_jsx("h3", { children: submission.title }), _jsx("p", { children: submission.aiStatement }), _jsx(Link, { className: "text-link", to: `/submissions/${submission.id}`, children: "Open manuscript" })] }), _jsxs("div", { className: "mini-meta", children: [_jsx("span", { children: submission.status }), _jsxs("span", { children: [submission.wordCount.toLocaleString(), " words"] }), _jsx("span", { children: submission.authors.join(', ') })] })] }, submission.id))) })] })] }));
}
function JudgePage() {
    const auth = useAuth();
    const [assignments, setAssignments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saveMessage, setSaveMessage] = useState(null);
    const [form, setForm] = useState(initialScorecardForm);
    async function loadAssignments() {
        try {
            setIsLoading(true);
            setError(null);
            const data = await fetchJson('/api/judging/assignments', undefined, auth);
            setAssignments(data.assignments);
            const firstAssignment = data.assignments[0];
            if (firstAssignment) {
                setForm((current) => ({ ...current, assignmentId: firstAssignment.id }));
            }
        }
        catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unknown error');
        }
        finally {
            setIsLoading(false);
        }
    }
    useEffect(() => {
        void loadAssignments();
    }, [auth.accessToken, auth.devSession]);
    async function handleScorecardSubmit(event) {
        event.preventDefault();
        setSaveMessage(null);
        const payload = {
            assignmentId: form.assignmentId,
            recommendation: form.recommendation,
            overallComment: form.overallComment,
            scores: form.scores,
        };
        try {
            const data = await fetchJson('/api/judging/scorecards', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }, auth);
            setSaveMessage(`Submitted scorecard for ${data.assignment.entryTitle}.`);
            await loadAssignments();
        }
        catch (submitError) {
            setSaveMessage(submitError instanceof Error ? submitError.message : 'Unable to submit scorecard');
        }
    }
    const activeAssignment = assignments.find((assignment) => assignment.id === form.assignmentId) ?? assignments[0] ?? null;
    return (_jsx(Shell, { title: "Judge portal", children: _jsxs("section", { className: "grid two-up", children: [!auth.user || !auth.user.roles.some((role) => ['judge', 'organizer', 'platform-admin'].includes(role)) ? (_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Judge access required" }), _jsx("p", { children: "Sign in as a judge, organizer, or platform admin to view assignments and score entries." })] })) : null, _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Blind review workflow" }), _jsx("p", { children: "Judges receive assignments, review anonymized entries, score weighted rubric dimensions, and submit written rationale without seeing entrant identities." }), isLoading ? _jsx("p", { className: "status", children: "Loading assignments\u2026" }) : null, error ? _jsx("p", { className: "status status-error", children: error }) : null, _jsx("div", { className: "grid contest-grid", children: assignments.map((assignment) => (_jsxs("article", { className: "contest-list-row", children: [_jsxs("div", { children: [_jsx("h3", { children: assignment.entryTitle }), _jsxs("p", { children: [assignment.assignedJudge, " \u00B7 ", assignment.status] }), _jsx(Link, { className: "text-link", to: `/submissions/${assignment.entryId}`, children: "Open manuscript" })] }), _jsxs("div", { className: "mini-meta", children: [_jsx("span", { children: new Date(assignment.assignedAt).toLocaleDateString() }), _jsx("span", { children: assignment.recommendation ?? 'pending' })] })] }, assignment.id))) })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Submit scorecard" }), _jsxs("form", { className: "stack-form", onSubmit: handleScorecardSubmit, children: [_jsxs("label", { children: [_jsx("span", { children: "Assignment" }), _jsx("select", { value: form.assignmentId, onChange: (event) => setForm((current) => ({ ...current, assignmentId: event.target.value })), children: assignments.map((assignment) => (_jsx("option", { value: assignment.id, children: assignment.entryTitle }, assignment.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "Recommendation" }), _jsxs("select", { value: form.recommendation, onChange: (event) => setForm((current) => ({ ...current, recommendation: event.target.value })), children: [_jsx("option", { value: "advance", children: "advance" }), _jsx("option", { value: "hold", children: "hold" }), _jsx("option", { value: "decline", children: "decline" })] })] }), form.scores.map((score, index) => (_jsxs("div", { className: "score-block", children: [_jsx("h3", { children: score.dimensionId }), _jsxs("label", { children: [_jsx("span", { children: "Score" }), _jsx("input", { type: "number", min: 1, max: 10, value: score.score, onChange: (event) => setForm((current) => ({
                                                        ...current,
                                                        scores: current.scores.map((candidate, candidateIndex) => candidateIndex === index
                                                            ? { ...candidate, score: Number(event.target.value) }
                                                            : candidate),
                                                    })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Comment" }), _jsx("textarea", { rows: 2, value: score.comment, onChange: (event) => setForm((current) => ({
                                                        ...current,
                                                        scores: current.scores.map((candidate, candidateIndex) => candidateIndex === index
                                                            ? { ...candidate, comment: event.target.value }
                                                            : candidate),
                                                    })) })] })] }, score.dimensionId))), _jsxs("label", { children: [_jsx("span", { children: "Overall comment" }), _jsx("textarea", { rows: 4, value: form.overallComment, onChange: (event) => setForm((current) => ({ ...current, overallComment: event.target.value })) })] }), _jsx("button", { className: "button-primary", type: "submit", children: "Submit scorecard" }), saveMessage ? _jsx("p", { className: "status", children: saveMessage }) : null, activeAssignment ? _jsxs("p", { className: "status", children: ["Scoring: ", activeAssignment.entryTitle] }) : null] })] })] }) }));
}
function OrganizerPage() {
    const auth = useAuth();
    const { contests, isLoading, error, reload, setIncludeDrafts } = useContests(auth.devSession, auth.accessToken);
    const [submissions, setSubmissions] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [dashboard, setDashboard] = useState(null);
    const [dashboardError, setDashboardError] = useState(null);
    const [scoreboards, setScoreboards] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);
    const [assignmentMessage, setAssignmentMessage] = useState(null);
    const [resultsMessage, setResultsMessage] = useState(null);
    const [form, setForm] = useState(() => createContestFormState(initialContestForm));
    const [editingContestId, setEditingContestId] = useState(null);
    const [assignmentForm, setAssignmentForm] = useState(initialAssignmentForm);
    const isAdmin = auth.user?.roles.includes('platform-admin') ?? false;
    const [resultSelections, setResultSelections] = useState({});
    useEffect(() => {
        setIncludeDrafts(true);
    }, [setIncludeDrafts]);
    useEffect(() => {
        async function loadOrganizerResources() {
            try {
                const [submissionsData, assignmentsData, scoreboardsData] = await Promise.all([
                    fetchJson('/api/submissions', undefined, auth),
                    fetchJson('/api/judging/assignments', undefined, auth),
                    fetchJson('/api/judging/summary', undefined, auth),
                ]);
                setSubmissions(submissionsData.submissions);
                setAssignments(assignmentsData.assignments);
                setScoreboards(scoreboardsData.scoreboards);
                setResultSelections((current) => {
                    const next = { ...current };
                    submissionsData.submissions.forEach((submission) => {
                        if (submission.status === 'submitted' ||
                            submission.status === 'under-review' ||
                            submission.status === 'finalist' ||
                            submission.status === 'winner') {
                            next[submission.id] = submission.status;
                        }
                        else if (!next[submission.id]) {
                            next[submission.id] = 'under-review';
                        }
                    });
                    return next;
                });
            }
            catch (loadError) {
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
                const data = (await response.json());
                setDashboard(data);
            }
            catch (loadError) {
                setDashboardError(loadError instanceof Error ? loadError.message : 'Unknown error');
            }
        }
        void loadDashboard();
    }, [auth.accessToken, auth.devSession, contests.length]);
    async function handleSaveContest(event) {
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
            const data = (await response.json());
            setEditingContestId(data.contest.id);
            setForm(createContestFormState(data.contest));
            setSaveMessage(`${editingContestId ? 'Updated' : 'Created'} ${data.contest.title}.`);
            await reload();
        }
        catch (saveError) {
            setSaveMessage(saveError instanceof Error ? saveError.message : 'Unable to save contest');
        }
        finally {
            setIsSaving(false);
        }
    }
    function startEditingContest(contest) {
        setEditingContestId(contest.id);
        setForm(createContestFormState(contest));
        setSaveMessage(null);
    }
    function resetContestEditor() {
        setEditingContestId(null);
        setForm(createContestFormState(initialContestForm));
        setSaveMessage(null);
    }
    async function handleCreateAssignment(event) {
        event.preventDefault();
        setAssignmentMessage(null);
        try {
            const data = await fetchJson('/api/judging/assignments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(assignmentForm),
            }, auth);
            setAssignmentMessage(`Assigned ${data.assignment.entryTitle} to ${data.assignment.assignedJudge}.`);
            const refreshedAssignments = await fetchJson('/api/judging/assignments', undefined, auth);
            setAssignments(refreshedAssignments.assignments);
            const refreshedScoreboards = await fetchJson('/api/judging/summary', undefined, auth);
            setScoreboards(refreshedScoreboards.scoreboards);
        }
        catch (saveError) {
            setAssignmentMessage(saveError instanceof Error ? saveError.message : 'Unable to create assignment');
        }
    }
    async function handleUpdateContestStage(contest, stage) {
        setResultsMessage(null);
        try {
            const response = await fetch(apiUrl(`/api/contests/${contest.id}`), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...buildAuthHeaders(auth.devSession, auth.accessToken),
                },
                body: JSON.stringify({ stage }),
            });
            const data = (await response.json());
            if (!response.ok) {
                throw new Error(typeof data === 'object' && data && 'message' in data && typeof data.message === 'string' ? data.message : `Update failed with ${response.status}`);
            }
            setResultsMessage(`Moved ${contest.title} to ${stage}.`);
            await reload();
            const refreshedScoreboards = await fetchJson('/api/judging/summary', undefined, auth);
            setScoreboards(refreshedScoreboards.scoreboards);
        }
        catch (saveError) {
            setResultsMessage(saveError instanceof Error ? saveError.message : 'Unable to update contest stage');
        }
    }
    async function handleUpdateSubmissionStatus(entryId) {
        setResultsMessage(null);
        try {
            const payload = {
                status: resultSelections[entryId] ?? 'under-review',
            };
            const data = await fetchJson(`/api/submissions/${entryId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }, auth);
            setResultsMessage(`Updated ${data.submission.title} to ${data.submission.status}.`);
            const refreshedSubmissions = await fetchJson('/api/submissions', undefined, auth);
            setSubmissions(refreshedSubmissions.submissions);
            const refreshedScoreboards = await fetchJson('/api/judging/summary', undefined, auth);
            setScoreboards(refreshedScoreboards.scoreboards);
        }
        catch (saveError) {
            setResultsMessage(saveError instanceof Error ? saveError.message : 'Unable to update submission result');
        }
    }
    return (_jsxs(Shell, { title: "Organizer admin", children: [_jsxs("section", { className: "grid two-up", children: [!auth.user || !auth.user.roles.some((role) => ['organizer', 'platform-admin'].includes(role)) ? (_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Organizer access required" }), _jsx("p", { children: "Sign in as an organizer or platform admin to manage contests and view the organizer dashboard." })] })) : null, _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Control center" }), _jsx("p", { children: "Create contests, define rules and rubric weights, assign judges, move stages forward, and publish finalists, winners, and public reading pages." }), dashboard ? (_jsxs("div", { className: "stats-grid", children: [_jsxs("div", { className: "stat-card", children: [_jsx("strong", { children: dashboard.stats.contests }), _jsx("span", { children: "contests" })] }), _jsxs("div", { className: "stat-card", children: [_jsx("strong", { children: dashboard.stats.teams }), _jsx("span", { children: "teams" })] }), _jsxs("div", { className: "stat-card", children: [_jsx("strong", { children: dashboard.stats.submissions }), _jsx("span", { children: "submissions" })] }), _jsxs("div", { className: "stat-card", children: [_jsx("strong", { children: dashboard.stats.judgingAssignments }), _jsx("span", { children: "assignments" })] })] })) : null, dashboardError ? _jsx("p", { className: "status status-error", children: dashboardError }) : null, _jsx("h3", { children: "Upcoming milestones" }), _jsx("ul", { children: dashboard?.upcomingMilestones.map((milestone) => (_jsxs("li", { children: [milestone.title, " \u2014 ", milestone.stage, " until ", new Date(milestone.closesAt).toLocaleDateString()] }, milestone.contestId))) })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: editingContestId ? 'Edit contest' : 'Create a contest' }), _jsxs("form", { className: "stack-form", onSubmit: handleSaveContest, children: [_jsxs("label", { children: [_jsx("span", { children: "Title" }), _jsx("input", { value: form.title, onChange: (event) => setForm((current) => ({ ...current, title: event.target.value })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Slug" }), _jsx("input", { value: form.slug, onChange: (event) => setForm((current) => ({ ...current, slug: event.target.value })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Tagline" }), _jsx("textarea", { value: form.tagline, onChange: (event) => setForm((current) => ({ ...current, tagline: event.target.value })), rows: 3 })] }), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { children: "Stage" }), _jsxs("select", { value: form.stage, onChange: (event) => setForm((current) => ({ ...current, stage: event.target.value })), children: [_jsx("option", { value: "draft", children: "draft" }), _jsx("option", { value: "published", children: "published" }), isAdmin && (_jsxs(_Fragment, { children: [_jsx("option", { value: "submission-open", children: "submission-open" }), _jsx("option", { value: "submission-closed", children: "submission-closed" }), _jsx("option", { value: "judging", children: "judging" }), _jsx("option", { value: "finalized", children: "finalized" }), _jsx("option", { value: "announced", children: "announced" })] }))] })] }), _jsxs("label", { children: [_jsx("span", { children: "Opens at" }), _jsx("input", { type: "datetime-local", value: form.opensAt.slice(0, 16), onChange: (event) => setForm((current) => ({ ...current, opensAt: `${event.target.value}:00.000Z` })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Closes at" }), _jsx("input", { type: "datetime-local", value: form.closesAt.slice(0, 16), onChange: (event) => setForm((current) => ({ ...current, closesAt: `${event.target.value}:00.000Z` })) })] })] }), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { children: "Max words" }), _jsx("input", { type: "number", min: 100, value: form.maxWords, onChange: (event) => setForm((current) => ({ ...current, maxWords: Number(event.target.value) })) })] }), _jsxs("label", { children: [_jsx("span", { children: "AI disclosure" }), _jsxs("select", { value: form.aiDisclosureMode, onChange: (event) => setForm((current) => ({ ...current, aiDisclosureMode: event.target.value })), children: [_jsx("option", { value: "required", children: "required" }), _jsx("option", { value: "optional", children: "optional" }), _jsx("option", { value: "contest-defined", children: "contest-defined" })] })] })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.allowsTeams, onChange: (event) => setForm((current) => ({ ...current, allowsTeams: event.target.checked })) }), _jsx("span", { children: "Allow team submissions" })] }), _jsxs("label", { children: [_jsx("span", { children: "Categories" }), _jsx("input", { value: form.categoriesText, onChange: (event) => setForm((current) => ({ ...current, categoriesText: event.target.value })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Judging focus" }), _jsx("input", { value: form.judgingFocusText, onChange: (event) => setForm((current) => ({ ...current, judgingFocusText: event.target.value })) })] }), _jsxs("div", { className: "meta-panel", children: [_jsx("h3", { children: "Submission policy" }), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { children: "Minimum words" }), _jsx("input", { type: "number", min: 1, max: form.maxWords, value: form.submissionPolicy.minWords, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    minWords: Number(event.target.value),
                                                                })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Max submissions per entrant" }), _jsx("input", { type: "number", min: 1, value: form.submissionPolicy.maxSubmissionsPerEntrant, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    maxSubmissionsPerEntrant: Number(event.target.value),
                                                                })) })] })] }), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { children: "Max submissions per team" }), _jsx("input", { type: "number", min: 1, value: form.submissionPolicy.maxSubmissionsPerTeam, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    maxSubmissionsPerTeam: Number(event.target.value),
                                                                })) })] }), _jsxs("label", { children: [_jsx("span", { children: "Max artifacts per submission" }), _jsx("input", { type: "number", min: 1, value: form.submissionPolicy.maxArtifactsPerSubmission, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    maxArtifactsPerSubmission: Number(event.target.value),
                                                                })) })] })] }), _jsxs("div", { className: "consent-grid", children: [_jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.requireSceneCards, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    requireSceneCards: event.target.checked,
                                                                })) }), _jsx("span", { children: "Require scene cards" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.requireReproductionSteps, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    requireReproductionSteps: event.target.checked,
                                                                })) }), _jsx("span", { children: "Require steps to reproduce" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.requirePromptHistory, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    requirePromptHistory: event.target.checked,
                                                                })) }), _jsx("span", { children: "Require prompt history" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.allowPublicReadingOptIn, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    allowPublicReadingOptIn: event.target.checked,
                                                                })) }), _jsx("span", { children: "Allow public reading opt-in" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.judgeCanViewAuthorIdentity, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    judgeCanViewAuthorIdentity: event.target.checked,
                                                                })) }), _jsx("span", { children: "Judges can see author identity" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.judgeCanViewAiDisclosure, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    judgeCanViewAiDisclosure: event.target.checked,
                                                                })) }), _jsx("span", { children: "Judges can see AI disclosure" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.judgeCanViewProvenance, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    judgeCanViewProvenance: event.target.checked,
                                                                })) }), _jsx("span", { children: "Judges can see provenance bundle" })] }), _jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: form.submissionPolicy.judgeCanViewArtifacts, onChange: (event) => setForm((current) => updatePolicySettings(current, {
                                                                    judgeCanViewArtifacts: event.target.checked,
                                                                })) }), _jsx("span", { children: "Judges can see artifacts" })] })] }), _jsxs("div", { className: "stack-form", children: [_jsx("span", { children: "Allowed artifact types" }), _jsx("div", { className: "consent-grid", children: submissionArtifactTypes.map((type) => {
                                                            const checked = form.submissionPolicy.allowedArtifactTypes.includes(type);
                                                            const isOnlyOption = checked && form.submissionPolicy.allowedArtifactTypes.length === 1;
                                                            return (_jsxs("label", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: checked, disabled: isOnlyOption, onChange: (event) => {
                                                                            const nextAllowed = event.target.checked
                                                                                ? [...form.submissionPolicy.allowedArtifactTypes, type]
                                                                                : form.submissionPolicy.allowedArtifactTypes.filter((candidate) => candidate !== type);
                                                                            setForm((current) => updatePolicySettings(current, {
                                                                                allowedArtifactTypes: nextAllowed,
                                                                            }));
                                                                        } }), _jsx("span", { children: type })] }, type));
                                                        }) })] }), _jsxs("label", { children: [_jsx("span", { children: "Cedar policy" }), _jsx("textarea", { rows: 14, value: form.submissionPolicy.cedarPolicy, onChange: (event) => setForm((current) => ({
                                                            ...current,
                                                            submissionPolicy: normalizeContestSubmissionPolicy({
                                                                ...current.submissionPolicy,
                                                                cedarPolicy: event.target.value,
                                                            }),
                                                            policyDirty: true,
                                                        })) })] }), _jsxs("div", { className: "session-actions", children: [_jsx("button", { className: "button-secondary", type: "button", onClick: () => setForm((current) => ({
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
                                                        })), children: "Regenerate Cedar policy from toggles" }), editingContestId ? (_jsx("button", { className: "button-secondary", type: "button", onClick: resetContestEditor, children: "Stop editing" })) : null] })] }), _jsx("button", { className: "button-primary", type: "submit", disabled: isSaving, children: isSaving ? 'Saving…' : editingContestId ? 'Save contest' : 'Create contest' }), saveMessage ? _jsx("p", { className: "status", children: saveMessage }) : null] })] })] }), _jsxs("section", { className: "grid two-up", children: [_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Assign judges" }), _jsxs("form", { className: "stack-form", onSubmit: handleCreateAssignment, children: [_jsxs("label", { children: [_jsx("span", { children: "Contest" }), _jsx("select", { value: assignmentForm.contestId, onChange: (event) => setAssignmentForm((current) => ({ ...current, contestId: event.target.value })), children: contests.map((contest) => (_jsx("option", { value: contest.id, children: contest.title }, contest.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "Submission" }), _jsx("select", { value: assignmentForm.entryId, onChange: (event) => setAssignmentForm((current) => ({ ...current, entryId: event.target.value })), children: submissions
                                                    .filter((submission) => submission.contestId === assignmentForm.contestId)
                                                    .map((submission) => (_jsx("option", { value: submission.id, children: submission.title }, submission.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "Judge name" }), _jsx("input", { value: assignmentForm.assignedJudge, onChange: (event) => setAssignmentForm((current) => ({ ...current, assignedJudge: event.target.value })) })] }), _jsx("button", { className: "button-primary", type: "submit", children: "Create assignment" }), assignmentMessage ? _jsx("p", { className: "status", children: assignmentMessage }) : null] })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Judging queue" }), _jsx("div", { className: "grid contest-grid", children: assignments.map((assignment) => (_jsxs("article", { className: "contest-list-row", children: [_jsxs("div", { children: [_jsx("h3", { children: assignment.entryTitle }), _jsx("p", { children: assignment.assignedJudge })] }), _jsxs("div", { className: "mini-meta", children: [_jsx("span", { children: assignment.status }), _jsx("span", { children: assignment.recommendation ?? 'pending' })] })] }, assignment.id))) })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Contest roster" }), isLoading ? _jsx("p", { className: "status", children: "Loading organizer roster\u2026" }) : null, error ? _jsx("p", { className: "status status-error", children: error }) : null, _jsx("div", { className: "grid contest-grid", children: contests.map((contest) => (_jsxs("article", { className: "contest-list-row", children: [_jsxs("div", { children: [_jsx("h3", { children: contest.title }), _jsx("p", { children: contest.tagline }), _jsxs("div", { className: "stage-actions", children: [_jsx("button", { className: "button-secondary", type: "button", onClick: () => startEditingContest(contest), children: "Edit" }), _jsx(Link, { className: "button-secondary inline-button", to: `/organizer/contests/${contest.id}/preview`, children: "Preview" }), isAdmin && (_jsxs(_Fragment, { children: [_jsx("button", { className: "button-secondary", type: "button", onClick: () => void handleUpdateContestStage(contest, 'submission-open'), children: "Open submissions" }), _jsx("button", { className: "button-secondary", type: "button", onClick: () => void handleUpdateContestStage(contest, 'judging'), children: "Move to judging" }), _jsx("button", { className: "button-secondary", type: "button", onClick: () => void handleUpdateContestStage(contest, 'finalized'), children: "Finalize" }), _jsx("button", { className: "button-primary", type: "button", onClick: () => void handleUpdateContestStage(contest, 'announced'), children: "Announce" })] }))] })] }), _jsxs("div", { className: "mini-meta", children: [_jsx("span", { children: contest.stage }), _jsxs("span", { children: [contest.submissionPolicy.minWords, "\u2013", contest.maxWords, " words"] }), _jsxs("span", { children: [contest.submissionPolicy.maxSubmissionsPerEntrant, " per entrant"] }), _jsx("span", { children: contest.allowsTeams ? 'Teams on' : 'Solo only' })] })] }, contest.id))) })] }), isAdmin && (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "Results publishing" }), _jsx("p", { children: "Promote strong entries to finalists or winners, then announce the contest to make those placements public." }), resultsMessage ? _jsx("p", { className: "status", children: resultsMessage }) : null, _jsx("div", { className: "grid contest-grid", children: submissions.map((submission) => (_jsxs("article", { className: "result-admin-row", children: [_jsxs("div", { children: [_jsx("h3", { children: submission.title }), _jsx("p", { children: submission.authors.join(', ') }), _jsx(Link, { className: "text-link", to: `/submissions/${submission.id}`, children: "Open manuscript" })] }), _jsxs("div", { className: "result-admin-controls", children: [_jsxs("select", { value: resultSelections[submission.id] ?? (submission.status === 'winner' || submission.status === 'finalist' || submission.status === 'submitted' || submission.status === 'under-review' ? submission.status : 'under-review'), onChange: (event) => setResultSelections((current) => ({
                                                ...current,
                                                [submission.id]: event.target.value,
                                            })), children: [_jsx("option", { value: "submitted", children: "submitted" }), _jsx("option", { value: "under-review", children: "under-review" }), _jsx("option", { value: "finalist", children: "finalist" }), _jsx("option", { value: "winner", children: "winner" })] }), _jsx("button", { className: "button-primary", type: "button", onClick: () => void handleUpdateSubmissionStatus(submission.id), children: "Save result" })] })] }, submission.id))) })] })), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Ranking board" }), _jsx("p", { children: "Weighted rubric averages and recommendation counts, so finalists are picked with receipts." }), _jsx("div", { className: "grid contest-grid", children: scoreboards.map((scoreboard) => (_jsxs("article", { className: "card result-card", children: [_jsx("h3", { children: scoreboard.contest.title }), _jsxs("p", { children: [scoreboard.contest.stage.replace('-', ' '), " \u00B7 ", scoreboard.entries.length, " submission", scoreboard.entries.length === 1 ? '' : 's'] }), _jsx("div", { className: "ranking-list", children: scoreboard.entries.map((entry) => (_jsxs("div", { className: "ranking-row", children: [_jsxs("div", { children: [_jsx("strong", { children: entry.rank ? `#${entry.rank}` : '—' }), _jsx("h4", { children: entry.title }), _jsx("p", { children: entry.authors.join(', ') }), _jsx(Link, { className: "text-link", to: `/submissions/${entry.entryId}`, children: "Open manuscript" })] }), _jsxs("div", { className: "mini-meta", children: [_jsxs("span", { children: [entry.averageScore.toFixed(2), " / 10"] }), _jsxs("span", { children: [entry.reviewCount, " review", entry.reviewCount === 1 ? '' : 's'] }), _jsxs("span", { children: ["A/H/D ", entry.recommendations.advance, "/", entry.recommendations.hold, "/", entry.recommendations.decline] }), _jsx("span", { children: entry.status })] })] }, entry.entryId))) })] }, scoreboard.contest.id))) })] })] }));
}
export function App() {
    const auth = useAuth();
    return (_jsxs("div", { className: "app-frame", children: [_jsxs("nav", { className: "top-nav", children: [_jsx("div", { className: "nav-left", children: _jsx(Link, { to: "/", className: "nav-brand", children: "Origin Draft" }) }), _jsxs("div", { className: "nav-links", children: [_jsx(Link, { to: "/#contests", children: "Contests" }), _jsx(Link, { to: "/results", children: "Results" }), _jsx(Link, { to: "/resources", children: "Resources" })] }), _jsxs("div", { className: "nav-right", children: [_jsx(DevToolbar, { auth: auth }), auth.user ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "nav-user", children: auth.user.displayName }), _jsx("button", { className: "button-secondary nav-button", type: "button", onClick: () => void auth.signOut(), children: "Sign Out" })] })) : auth.isLoading ? null : (_jsx("button", { className: "button-primary nav-button", type: "button", onClick: () => void auth.signIn(), children: "Sign In" }))] })] }), _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(HomePage, {}) }), _jsx(Route, { path: "/auth/callback", element: _jsx(AuthCallbackPage, {}) }), _jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/results", element: _jsx(ResultsPage, {}) }), _jsx(Route, { path: "/resources", element: _jsx(ResourcesPage, {}) }), _jsx(Route, { path: "/terms", element: _jsx(TermsPage, {}) }), _jsx(Route, { path: "/privacy", element: _jsx(PrivacyPage, {}) }), _jsx(Route, { path: "/read/:entryId", element: _jsx(PublicReadingPage, {}) }), _jsx(Route, { path: "/submissions/:entryId", element: (_jsx(RequireRoles, { roles: ['entrant', 'judge', 'organizer', 'platform-admin'], title: "Submission detail", children: _jsx(SubmissionDetailPage, {}) })) }), _jsx(Route, { path: "/entrant", element: (_jsx(RequireRoles, { roles: ['entrant', 'organizer', 'platform-admin'], title: "Entrant portal", children: _jsx(EntrantPage, {}) })) }), _jsx(Route, { path: "/judge", element: (_jsx(RequireRoles, { roles: ['judge', 'organizer', 'platform-admin'], title: "Judge portal", children: _jsx(JudgePage, {}) })) }), _jsx(Route, { path: "/organizer", element: (_jsx(RequireRoles, { roles: ['organizer', 'platform-admin'], title: "Organizer admin", children: _jsx(OrganizerPage, {}) })) }), _jsx(Route, { path: "/organizer/contests/:contestId/preview", element: (_jsx(RequireRoles, { roles: ['organizer', 'platform-admin'], title: "Contest preview", children: _jsx(ContestPreviewPage, {}) })) })] })] }));
}
