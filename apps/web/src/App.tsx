import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { BookOpen, Brain, CalendarCheck, Code2, Flame, Goal, Loader2, Pencil, Play, Plus, RotateCcw, Sparkles, Square, TimerReset, Trash2 } from 'lucide-react';
import { createSession, deleteSession, generateWeeklySummary, loadBootstrap, loadDashboard, updateSession } from './api';
import type { BootstrapData, CodingSession, DashboardData, LearningSession } from './types';

type SessionMode = 'CODING' | 'LEARNING';
type DashboardRange = 'today' | 'week' | 'month' | 'all';
const TIMER_STORAGE_KEY = 'codetrail.timer.v1';
const QUICK_LOG_STORAGE_KEY = 'codetrail.quick-log.v1';
const dashboardRangeOptions: { label: string; value: DashboardRange }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'All', value: 'all' },
];

type StoredTimer = {
  elapsedBeforeStart: number;
  elapsedSeconds: number;
  isRunning: boolean;
  manualMinutes: string;
  mode: SessionMode;
  startedAt: number | null;
};

type QuickLogDraft = {
  detailsOpen: boolean;
  mode: SessionMode;
  notes: string;
  projectId: string;
  source: string;
  technologyIds: string[];
  title: string;
};

type StoredQuickLog = {
  drafts: Record<SessionMode, QuickLogDraft>;
  mode: SessionMode;
};

const defaultWorkDraft: QuickLogDraft = {
  detailsOpen: false,
  mode: 'CODING',
  notes: '',
  projectId: '',
  source: 'Docs and practice',
  technologyIds: [],
  title: 'Work session',
};

const defaultLearningDraft: QuickLogDraft = {
  detailsOpen: false,
  mode: 'LEARNING',
  notes: '',
  projectId: '',
  source: 'Docs and practice',
  technologyIds: [],
  title: 'Learning session',
};

const defaultQuickLogDrafts: Record<SessionMode, QuickLogDraft> = {
  CODING: defaultWorkDraft,
  LEARNING: defaultLearningDraft,
};

export function App() {
  const [storedQuickLog] = useState(readStoredQuickLog);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>('week');
  const [quickLogDrafts, setQuickLogDrafts] = useState<Record<SessionMode, QuickLogDraft>>(() => storedQuickLog?.drafts ?? defaultQuickLogDrafts);
  const [mode, setMode] = useState<SessionMode>(() => storedQuickLog?.mode ?? 'CODING');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{
    id: string;
    title: string;
    type: SessionMode;
    minutes: number;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
    type: SessionMode;
  } | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerStorageReady, setIsTimerStorageReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [manualMinutes, setManualMinutes] = useState('60');
  const [summary, setSummary] = useState('');
  const timerStartedAt = useRef<number | null>(null);
  const elapsedBeforeStart = useRef(0);

  const refresh = useCallback(
    async (range = dashboardRange) => {
      const [bootstrapData, dashboardData] = await Promise.all([loadBootstrap(), loadDashboard(range)]);
      setBootstrap(bootstrapData);
      setDashboard(dashboardData);
    },
    [dashboardRange],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const restoredTimer = readStoredTimer();
    if (!restoredTimer) {
      setIsTimerStorageReady(true);
      return;
    }

    elapsedBeforeStart.current = restoredTimer.elapsedBeforeStart;
    timerStartedAt.current = restoredTimer.startedAt;
    setMode(restoredTimer.mode);
    setManualMinutes(restoredTimer.manualMinutes);

    if (restoredTimer.isRunning && restoredTimer.startedAt !== null) {
      const secondsSinceStart = Math.floor((Date.now() - restoredTimer.startedAt) / 1000);
      const restoredElapsed = restoredTimer.elapsedBeforeStart + Math.max(0, secondsSinceStart);
      setElapsedSeconds(restoredElapsed);
      setManualMinutes(String(Math.max(5, Math.ceil(restoredElapsed / 60))));
      setIsTimerRunning(true);
    } else {
      setElapsedSeconds(restoredTimer.elapsedSeconds);
      setIsTimerRunning(false);
    }

    setIsTimerStorageReady(true);
  }, []);

  useEffect(() => {
    if (!isTimerRunning || timerStartedAt.current === null) return;

    const intervalId = window.setInterval(() => {
      const secondsSinceStart = Math.floor((Date.now() - timerStartedAt.current!) / 1000);
      setElapsedSeconds(elapsedBeforeStart.current + secondsSinceStart);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isTimerRunning]);

  useEffect(() => {
    if (!isTimerStorageReady) return;

    if (!isTimerRunning && elapsedSeconds === 0 && manualMinutes === '60') {
      removeStoredTimer();
      return;
    }

    writeStoredTimer({
      elapsedBeforeStart: elapsedBeforeStart.current,
      elapsedSeconds,
      isRunning: isTimerRunning,
      manualMinutes,
      mode,
      startedAt: timerStartedAt.current,
    });
  }, [elapsedSeconds, isTimerRunning, isTimerStorageReady, manualMinutes, mode]);

  useEffect(() => {
    writeStoredQuickLog({ drafts: quickLogDrafts, mode });
  }, [mode, quickLogDrafts]);

  useEffect(() => {
    if (!pendingDelete && !pendingEdit) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPendingDelete(null);
        setPendingEdit(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingDelete, pendingEdit]);

  const firstProject = bootstrap?.projects[0];
  const quickLogDraft = quickLogDrafts[mode];

  function handleModeChange(nextMode: SessionMode) {
    setMode(nextMode);
  }

  function updateQuickLogDraft(patch: Partial<QuickLogDraft>) {
    setQuickLogDrafts((drafts) => ({
      ...drafts,
      [mode]: { ...drafts[mode], ...patch, mode },
    }));
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bootstrap) return;

    const form = new FormData(event.currentTarget);
    const finalElapsedSeconds = getCurrentElapsedSeconds();
    const minutes = isTimerRunning ? Math.max(5, Math.ceil(finalElapsedSeconds / 60)) : Number(form.get('minutes'));
    const title = String(form.get('title'));
    const notes = String(form.get('notes') ?? '');
    const projectId = String(form.get('projectId') ?? '');
    const source = String(form.get('source') ?? '');

    if (isTimerRunning) {
      stopTimer();
    }

    setSummary('');
    setIsSaving(true);
    try {
      try {
        const createdSession = await createSession({
          type: mode,
          title,
          topic: title,
          source: source || 'Self study',
          minutes,
          notes: notes || undefined,
          projectId: mode === 'CODING' ? projectId || undefined : undefined,
          technologyIds: form.getAll('technologyIds'),
        });
        applyCreatedSession(mode, createdSession);
      } catch {
        setSummary('The local API is not connected yet, so this session stayed in the browser preview. Once PostgreSQL is configured, saves will persist.');
        return;
      }

      try {
        await refresh();
        setSummary('');
      } catch {
        setSummary('Session saved. Refresh the page if the dashboard does not update right away.');
      }
    } finally {
      resetTimer();
      setManualMinutes('60');
      setIsSaving(false);
    }
  }

  function applyCreatedSession(type: SessionMode, session: CodingSession | LearningSession | { ok: boolean; persisted: false; reason: string }) {
    if (!('id' in session)) return;

    applyCreatedSessionToDashboard(type, session);

    setBootstrap((current) => {
      if (!current) return current;

      if (type === 'CODING') {
        return {
          ...current,
          recentCoding: [session as CodingSession, ...current.recentCoding.filter((item) => item.id !== session.id)].slice(0, 8),
        };
      }

      return {
        ...current,
        recentLearning: [session as LearningSession, ...current.recentLearning.filter((item) => item.id !== session.id)].slice(0, 8),
      };
    });
  }

  function applyCreatedSessionToDashboard(type: SessionMode, session: CodingSession | LearningSession) {
    const sessionDate = session.sessionDate.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const isToday = sessionDate === today;
    const isInSelectedRange = isDateInRange(sessionDate, dashboardRange);

    setDashboard((current) => {
      if (!current) return current;

      const codingMinutes = type === 'CODING' ? session.minutes : 0;
      const learningMinutes = type === 'LEARNING' ? session.minutes : 0;
      const totalMinutes = codingMinutes + learningMinutes;
      const history = isInSelectedRange ? upsertHistoryDay(current.history, sessionDate, codingMinutes, learningMinutes) : current.history;
      const technologies =
        type === 'CODING'
          ? updateTechnologyFocus(current.technologies, (session as CodingSession).technologies, session.minutes)
          : current.technologies;

      return {
        ...current,
        stats: {
          ...current.stats,
          codingHoursToday: isToday ? addMinutesToHours(current.stats.codingHoursToday, codingMinutes) : current.stats.codingHoursToday,
          learningHoursToday: isToday ? addMinutesToHours(current.stats.learningHoursToday, learningMinutes) : current.stats.learningHoursToday,
          totalHoursToday: isToday ? addMinutesToHours(current.stats.totalHoursToday, totalMinutes) : current.stats.totalHoursToday,
          rangeCodingHours: isInSelectedRange ? addMinutesToHours(current.stats.rangeCodingHours, codingMinutes) : current.stats.rangeCodingHours,
          rangeLearningHours: isInSelectedRange ? addMinutesToHours(current.stats.rangeLearningHours, learningMinutes) : current.stats.rangeLearningHours,
          rangeTotalHours: isInSelectedRange ? addMinutesToHours(current.stats.rangeTotalHours, totalMinutes) : current.stats.rangeTotalHours,
          codingHoursThisWeek: isDateInRange(sessionDate, 'week')
            ? addMinutesToHours(current.stats.codingHoursThisWeek, codingMinutes)
            : current.stats.codingHoursThisWeek,
          learningHoursThisWeek: isDateInRange(sessionDate, 'week')
            ? addMinutesToHours(current.stats.learningHoursThisWeek, learningMinutes)
            : current.stats.learningHoursThisWeek,
          totalHoursLast30Days: isWithinLastDays(sessionDate, 30)
            ? addMinutesToHours(current.stats.totalHoursLast30Days, totalMinutes)
            : current.stats.totalHoursLast30Days,
          streakDays: isToday && current.stats.streakDays === 0 ? 1 : current.stats.streakDays,
        },
        chart: isInSelectedRange ? history.slice().reverse().map((day) => ({ date: day.date, hours: day.totalHours })) : current.chart,
        history,
        technologies,
      };
    });
  }

  function startTimer() {
    elapsedBeforeStart.current = elapsedSeconds;
    timerStartedAt.current = Date.now();
    setIsTimerRunning(true);
  }

  function getCurrentElapsedSeconds() {
    if (!isTimerRunning || timerStartedAt.current === null) {
      return elapsedSeconds;
    }

    const secondsSinceStart = Math.floor((Date.now() - timerStartedAt.current) / 1000);
    return elapsedBeforeStart.current + secondsSinceStart;
  }

  function stopTimer() {
    const totalSeconds = getCurrentElapsedSeconds();
    setElapsedSeconds(totalSeconds);
    setManualMinutes(String(Math.max(5, Math.ceil(totalSeconds / 60))));
    elapsedBeforeStart.current = totalSeconds;

    timerStartedAt.current = null;
    setIsTimerRunning(false);
  }

  function resetTimer() {
    timerStartedAt.current = null;
    elapsedBeforeStart.current = 0;
    setElapsedSeconds(0);
    setIsTimerRunning(false);
    removeStoredTimer();
  }

  async function handleSummary() {
    setIsGeneratingSummary(true);
    try {
      const result = await generateWeeklySummary();
      setSummary(result.content);
    } catch {
      setSummary(
        'This week has a strong foundation: keep logging sessions, protect one deep-work block, and ship the next visible slice of your flagship project.',
      );
    } finally {
      setIsGeneratingSummary(false);
    }
  }

  async function confirmDeleteSession(activity: { id: string; title: string; type: SessionMode }) {
    if (!bootstrap) return;

    setDeletingSessionId(activity.id);
    const previousBootstrap = bootstrap;
    setPendingDelete(null);
    setBootstrap({
      ...bootstrap,
      recentCoding: activity.type === 'CODING' ? bootstrap.recentCoding.filter((session) => session.id !== activity.id) : bootstrap.recentCoding,
      recentLearning: activity.type === 'LEARNING' ? bootstrap.recentLearning.filter((session) => session.id !== activity.id) : bootstrap.recentLearning,
    });

    try {
      await deleteSession(activity.type, activity.id);
      await refresh();
    } catch {
      setBootstrap(previousBootstrap);
      setSummary('Could not delete that session. Please try again.');
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleEditSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingEdit) return;

    const form = new FormData(event.currentTarget);
    const title = String(form.get('title'));
    const minutes = Number(form.get('minutes'));

    setSavingEditId(pendingEdit.id);
    try {
      await updateSession(pendingEdit.type, pendingEdit.id, { title, minutes });
      setPendingEdit(null);
      await refresh();
    } catch {
      setSummary('Could not update that session. Please check the values and try again.');
    } finally {
      setSavingEditId(null);
    }
  }

  const recentActivity = useMemo(() => {
    if (!bootstrap) return [];
    return [
      ...bootstrap.recentCoding.map((session) => ({
        id: session.id,
        kind: 'Work',
        type: 'CODING' as const,
        title: session.title,
        minutes: session.minutes,
        date: session.sessionDate,
      })),
      ...bootstrap.recentLearning.map((session) => ({
        id: session.id,
        kind: 'Learning',
        type: 'LEARNING' as const,
        title: session.topic,
        minutes: session.minutes,
        date: session.sessionDate,
      })),
    ]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 6);
  }, [bootstrap]);

  if (!bootstrap || !dashboard) {
    return (
      <main className="loading">
        <Loader2 className="spin" size={28} />
        <span>Loading CodeTrail</span>
      </main>
    );
  }

  const todayCodingHours = dashboard.stats.codingHoursToday ?? 0;
  const todayLearningHours = dashboard.stats.learningHoursToday ?? 0;
  const todayTotalHours = dashboard.stats.totalHoursToday ?? todayCodingHours + todayLearningHours;

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="CodeTrail navigation">
        <div className="brand">
          <div className="brand-mark">CT</div>
          <div>
            <strong>CodeTrail</strong>
            <span>Developer progress OS</span>
          </div>
        </div>

        <nav>
          <a className="active" href="#dashboard">
            <TimerReset size={18} /> Dashboard
          </a>
          <a href="#sessions">
            <Code2 size={18} /> Sessions
          </a>
          <a href="#goals">
            <Goal size={18} /> Goals
          </a>
          <a href="#insights">
            <Brain size={18} /> Insights
          </a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Welcome back</p>
            <h1>{bootstrap.user.name}</h1>
          </div>
        </header>

        <section className="daily-grid">
          <div className="daily-overview">
            <section className="today-summary" aria-label="Today summary">
              <div>
                <p className="eyebrow">Total today</p>
                <strong>{formatHours(todayTotalHours)}h</strong>
              </div>
              <dl>
                <div>
                  <dt>Work</dt>
                  <dd>{formatHours(todayCodingHours)}h</dd>
                </div>
                <div>
                  <dt>Learning</dt>
                  <dd>{formatHours(todayLearningHours)}h</dd>
                </div>
              </dl>
            </section>

            <section id="dashboard" className="stats-grid">
              <Metric icon={<Code2 />} label={`${dashboard.stats.rangeLabel} work`} value={`${formatHours(dashboard.stats.rangeCodingHours)}h`} />
              <Metric icon={<BookOpen />} label={`${dashboard.stats.rangeLabel} learning`} value={`${formatHours(dashboard.stats.rangeLearningHours)}h`} />
              <Metric icon={<CalendarCheck />} label={`${dashboard.stats.rangeLabel} total`} value={`${formatHours(dashboard.stats.rangeTotalHours)}h`} />
              <Metric icon={<Flame />} label="Current streak" value={`${dashboard.stats.streakDays}d`} />

            </section>
          </div>

          <QuickLogPanel
            bootstrap={bootstrap}
            draft={quickLogDraft}
            elapsedSeconds={elapsedSeconds}
            firstProject={firstProject}
            isSaving={isSaving}
            isTimerRunning={isTimerRunning}
            manualMinutes={manualMinutes}
            mode={mode}
            onDraftChange={updateQuickLogDraft}
            onModeChange={handleModeChange}
            onResetTimer={resetTimer}
            onStartTimer={startTimer}
            onStopTimer={stopTimer}
            onSubmit={handleSubmit}
            onMinutesChange={setManualMinutes}
          />
        </section>

        <section className="main-grid">
          <article className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>Daily totals</h2>
              </div>
              <div className="range-tabs" aria-label="Dashboard range">
                {dashboardRangeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={dashboardRange === option.value ? 'selected' : ''}
                    onClick={() => setDashboardRange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <RangeChart
              chart={dashboard.chart}
              codingHours={dashboard.stats.rangeCodingHours}
              learningHours={dashboard.stats.rangeLearningHours}
              totalHours={dashboard.stats.rangeTotalHours}
            />
          </article>

          <article className="panel recent-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2>Recent activity</h2>
              </div>
            </div>
            <div className="activity-list">
              {recentActivity.map((activity) => (
                <div key={`${activity.kind}-${activity.id}`} className="activity-row">
                  <span>{activity.kind}</span>
                  <strong>{activity.title}</strong>
                  <time>{Math.round((activity.minutes / 60) * 10) / 10}h</time>
                  <button
                    type="button"
                    className="edit-activity"
                    onClick={() => setPendingEdit(activity)}
                    disabled={savingEditId === activity.id || deletingSessionId === activity.id}
                    aria-label={`Edit ${activity.title}`}
                    title="Edit session"
                  >
                    {savingEditId === activity.id ? <Loader2 className="spin" size={15} /> : <Pencil size={15} />}
                  </button>
                  <button
                    type="button"
                    className="delete-activity"
                    onClick={() => setPendingDelete(activity)}
                    disabled={deletingSessionId === activity.id}
                    aria-label={`Delete ${activity.title}`}
                    title="Delete session"
                  >
                    {deletingSessionId === activity.id ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                  </button>
                </div>
              ))}
            </div>
          </article>

          <article id="goals" className="panel goals-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Targets</p>
                <h2>Active goals</h2>
              </div>
            </div>
            <div className="goal-list">
              {bootstrap.goals.map((goal) => {
                const percent = Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100));
                return (
                  <div className="goal-item" key={goal.id}>
                    <div>
                      <strong>{goal.title}</strong>
                      <span>
                        {goal.currentValue}/{goal.targetValue} {goal.unit}
                      </span>
                    </div>
                    <div className="progress" aria-label={`${percent}% complete`}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="panel tech-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Skill signal</p>
                <h2>Technology focus</h2>
              </div>
            </div>
            <ChartSurface height={230} className="compact">
              {({ width, height }) => (
                <BarChart width={width} height={height} data={dashboard.technologies} layout="vertical" margin={{ left: 12, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d7dde8" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={82} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="hours" fill="#3a8f5a" radius={[0, 6, 6, 0]} />
                </BarChart>
              )}
            </ChartSurface>
          </article>

          <article id="insights" className="panel insight-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Readout</p>
                <h2>Insights</h2>
              </div>
            </div>
            <section className="ai-summary-card" aria-label="Weekly AI summary">
              <div>
                <Sparkles size={18} />
                <div>
                  <strong>Weekly AI summary</strong>
                  {summary ? <p>{summary}</p> : <p>Generate a short coaching note from your latest work, learning, and goals.</p>}
                </div>
              </div>
              <button type="button" className="secondary-button" onClick={handleSummary} disabled={isGeneratingSummary}>
                {isGeneratingSummary ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                {summary ? 'Refresh' : 'Generate'}
              </button>
            </section>
            <ul className="insight-list">
              {dashboard.insights.map((insight) => (
                <li key={insight}>
                  <Brain size={17} />
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </section>

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingDelete(null)}>
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <p className="eyebrow">Delete session</p>
              <h2 id="delete-dialog-title">Remove this log?</h2>
              <p id="delete-dialog-description">This will delete "{pendingDelete.title}" and update your totals.</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={() => confirmDeleteSession(pendingDelete)}>
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingEdit && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingEdit(null)}>
          <form
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleEditSubmit}
          >
            <div>
              <p className="eyebrow">Edit session</p>
              <h2 id="edit-dialog-title">{pendingEdit.type === 'CODING' ? 'Work log' : 'Learning log'}</h2>
            </div>
            <div className="edit-fields">
              <label>
                <span>{pendingEdit.type === 'CODING' ? 'Title' : 'Topic'}</span>
                <input name="title" defaultValue={pendingEdit.title} minLength={2} required />
              </label>
              <label>
                <span>Minutes</span>
                <input name="minutes" type="number" min="5" max="1440" defaultValue={pendingEdit.minutes} required />
              </label>
            </div>
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingEdit(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={savingEditId === pendingEdit.id}>
                {savingEditId === pendingEdit.id ? <Loader2 className="spin" size={16} /> : <Pencil size={16} />}
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((unit) => String(unit).padStart(2, '0')).join(':');
}

function formatHours(hours: number) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function addMinutesToHours(hours: number, minutes: number) {
  return Math.round(((Math.round(hours * 60) + minutes) / 60) * 10) / 10;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcWeek(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  return start;
}

function isDateInRange(date: string, range: DashboardRange) {
  if (range === 'all') return true;
  if (range === 'today') return date === dateKey(new Date());
  if (range === 'week') return date >= dateKey(startOfUtcWeek());

  const now = new Date();
  return date >= dateKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

function isWithinLastDays(date: string, days: number) {
  const start = new Date();
  start.setDate(start.getDate() - days);
  return date >= dateKey(start);
}

function upsertHistoryDay(history: DashboardData['history'], date: string, codingMinutes: number, learningMinutes: number) {
  const existingDay = history.find((day) => day.date === date);
  const updatedDay = {
    date,
    codingHours: addMinutesToHours(existingDay?.codingHours ?? 0, codingMinutes),
    learningHours: addMinutesToHours(existingDay?.learningHours ?? 0, learningMinutes),
    totalHours: addMinutesToHours(existingDay?.totalHours ?? 0, codingMinutes + learningMinutes),
  };

  return [updatedDay, ...history.filter((day) => day.date !== date)].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function updateTechnologyFocus(
  currentTechnologies: DashboardData['technologies'],
  sessionTechnologies: CodingSession['technologies'],
  minutes: number,
) {
  const technologies = new Map(currentTechnologies.map((technology) => [technology.name, { ...technology }]));

  sessionTechnologies.forEach(({ technology }) => {
    const current = technologies.get(technology.name) ?? {
      name: technology.name,
      color: technology.color,
      hours: 0,
      minutes: 0,
    };
    const nextMinutes = current.minutes + minutes;
    technologies.set(technology.name, {
      ...current,
      color: technology.color,
      minutes: nextMinutes,
      hours: Math.round((nextMinutes / 60) * 10) / 10,
    });
  });

  return [...technologies.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 6);
}

function RangeChart({
  chart,
  codingHours,
  learningHours,
  totalHours,
}: {
  chart: DashboardData['chart'];
  codingHours: number;
  learningHours: number;
  totalHours: number;
}) {
  return (
    <>
      <dl className="history-summary" aria-label="Selected range totals">
        <div>
          <dt>Total</dt>
          <dd>{formatHours(totalHours)}h</dd>
        </div>
        <div>
          <dt>Work</dt>
          <dd>{formatHours(codingHours)}h</dd>
        </div>
        <div>
          <dt>Learning</dt>
          <dd>{formatHours(learningHours)}h</dd>
        </div>
      </dl>

      {chart.length === 0 ? (
        <p className="empty-history">No sessions logged for this range yet.</p>
      ) : (
        <ChartSurface height={290}>
          {({ width, height }) => (
            <AreaChart width={width} height={height} data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d7dde8" />
              <XAxis dataKey="date" tickFormatter={(date) => date.slice(5)} tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <Tooltip />
              <Area type="monotone" dataKey="hours" stroke="#2f80ed" fill="#b9d7ff" strokeWidth={2} />
            </AreaChart>
          )}
        </ChartSurface>
      )}
    </>
  );
}

function readStoredTimer() {
  try {
    const rawTimer = window.localStorage.getItem(TIMER_STORAGE_KEY);
    if (!rawTimer) return null;

    const parsed = JSON.parse(rawTimer) as Partial<StoredTimer>;
    if (parsed.mode !== 'CODING' && parsed.mode !== 'LEARNING') return null;

    return {
      elapsedBeforeStart: Number(parsed.elapsedBeforeStart ?? 0),
      elapsedSeconds: Number(parsed.elapsedSeconds ?? 0),
      isRunning: Boolean(parsed.isRunning),
      manualMinutes: String(parsed.manualMinutes ?? '60'),
      mode: parsed.mode,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
    } satisfies StoredTimer;
  } catch {
    removeStoredTimer();
    return null;
  }
}

function writeStoredTimer(timer: StoredTimer) {
  try {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timer));
  } catch {
    // Timer persistence is a convenience; tracking should still work without storage.
  }
}

function removeStoredTimer() {
  try {
    window.localStorage.removeItem(TIMER_STORAGE_KEY);
  } catch {
    // Ignore storage failures so reset/save never breaks the logging flow.
  }
}

function readStoredQuickLog() {
  try {
    const rawDraft = window.localStorage.getItem(QUICK_LOG_STORAGE_KEY);
    if (!rawDraft) return null;

    const parsed = JSON.parse(rawDraft) as Partial<StoredQuickLog & QuickLogDraft>;
    const mode = parsed.mode === 'LEARNING' ? 'LEARNING' : 'CODING';

    if (parsed.drafts) {
      return {
        drafts: {
          CODING: normalizeQuickLogDraft(parsed.drafts.CODING, 'CODING'),
          LEARNING: normalizeQuickLogDraft(parsed.drafts.LEARNING, 'LEARNING'),
        },
        mode,
      } satisfies StoredQuickLog;
    }

    const migratedDraft = normalizeQuickLogDraft(parsed, mode);
    return {
      drafts: {
        ...defaultQuickLogDrafts,
        [mode]: migratedDraft,
      },
      mode,
    } satisfies StoredQuickLog;
  } catch {
    removeStoredQuickLog();
    return null;
  }
}

function normalizeQuickLogDraft(draft: Partial<QuickLogDraft> | undefined, mode: SessionMode) {
  const defaults = defaultQuickLogDrafts[mode];

  return {
    detailsOpen: Boolean(draft?.detailsOpen ?? defaults.detailsOpen),
    mode,
    notes: String(draft?.notes ?? defaults.notes),
    projectId: String(draft?.projectId ?? defaults.projectId),
    source: String(draft?.source ?? defaults.source),
    technologyIds: Array.isArray(draft?.technologyIds) ? draft.technologyIds.map(String) : defaults.technologyIds,
    title: draft?.title === 'Coding session' ? 'Work session' : String(draft?.title ?? defaults.title),
  } satisfies QuickLogDraft;
}

function writeStoredQuickLog(draft: StoredQuickLog) {
  try {
    window.localStorage.setItem(QUICK_LOG_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Form persistence should never block logging a session.
  }
}

function removeStoredQuickLog() {
  try {
    window.localStorage.removeItem(QUICK_LOG_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the form can still work without persistence.
  }
}

function QuickLogPanel({
  bootstrap,
  draft,
  elapsedSeconds,
  firstProject,
  isSaving,
  isTimerRunning,
  manualMinutes,
  mode,
  onModeChange,
  onDraftChange,
  onMinutesChange,
  onResetTimer,
  onStartTimer,
  onStopTimer,
  onSubmit,
}: {
  bootstrap: BootstrapData;
  draft: QuickLogDraft;
  elapsedSeconds: number;
  firstProject?: BootstrapData['projects'][number];
  isSaving: boolean;
  isTimerRunning: boolean;
  manualMinutes: string;
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  onDraftChange: (patch: Partial<QuickLogDraft>) => void;
  onMinutesChange: (minutes: string) => void;
  onResetTimer: () => void;
  onStartTimer: () => void;
  onStopTimer: () => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
  const selectedProjectId = draft.projectId || firstProject?.id || '';

  function handleTechnologyChange(technologyId: string, checked: boolean) {
    onDraftChange({
      technologyIds: checked ? [...draft.technologyIds, technologyId] : draft.technologyIds.filter((id) => id !== technologyId),
    });
  }

  return (
    <article id="sessions" className="panel log-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Quick log</p>
          <h2>Add a session</h2>
        </div>
        <div className="segmented" aria-label="Session type">
          <button type="button" className={mode === 'CODING' ? 'selected' : ''} onClick={() => onModeChange('CODING')}>
            <Code2 size={16} /> Work
          </button>
          <button type="button" className={mode === 'LEARNING' ? 'selected' : ''} onClick={() => onModeChange('LEARNING')}>
            <BookOpen size={16} /> Learn
          </button>
        </div>
      </div>

      <form onSubmit={onSubmit} className="session-form">
        <div className="timer-card">
          <div>
            <span>Timer</span>
            <strong>{formatDuration(elapsedSeconds)}</strong>
          </div>
          <div className="timer-actions">
            <button type="button" className="icon-button start" onClick={onStartTimer} disabled={isTimerRunning} aria-label="Start timer" title="Start timer">
              <Play size={16} />
            </button>
            <button
              type="button"
              className="icon-button stop"
              onClick={onStopTimer}
              disabled={!isTimerRunning && elapsedSeconds === 0}
              aria-label="Stop timer"
              title="Stop timer"
            >
              <Square size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onResetTimer}
              disabled={elapsedSeconds === 0 && !isTimerRunning}
              aria-label="Reset timer"
              title="Reset timer"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
        <label>
          <span>Minutes</span>
          <input name="minutes" type="number" min="5" max="1440" value={manualMinutes} onChange={(event) => onMinutesChange(event.target.value)} required />
        </label>

        <details className="optional-details" open={draft.detailsOpen} onToggle={(event) => onDraftChange({ detailsOpen: event.currentTarget.open })}>
          <summary>Details</summary>
          <div className="details-fields">
            <label>
              <span>{mode === 'CODING' ? 'Work title' : 'Topic'}</span>
              <input name="title" value={draft.title} onChange={(event) => onDraftChange({ title: event.target.value })} required />
            </label>

            <div className="form-row">
              {mode === 'CODING' ? (
                <label>
                  <span>Project</span>
                  <select name="projectId" value={selectedProjectId} onChange={(event) => onDraftChange({ projectId: event.target.value })}>
                    {bootstrap.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  <span>Source</span>
                  <input name="source" value={draft.source} onChange={(event) => onDraftChange({ source: event.target.value })} />
                </label>
              )}
            </div>

            <fieldset>
              <legend>Technologies</legend>
              <div className="tech-picker">
                {bootstrap.technologies.map((technology) => (
                  <label key={technology.id} style={{ borderColor: technology.color }}>
                    <input
                      type="checkbox"
                      name="technologyIds"
                      value={technology.id}
                      checked={draft.technologyIds.includes(technology.id)}
                      onChange={(event) => handleTechnologyChange(technology.id, event.target.checked)}
                    />
                    {technology.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <label>
              <span>Notes</span>
              <textarea
                name="notes"
                rows={3}
                placeholder="What moved forward? What felt sticky?"
                value={draft.notes}
                onChange={(event) => onDraftChange({ notes: event.target.value })}
              />
            </label>
          </div>
        </details>

        <button className="primary-button" disabled={isSaving}>
          {isSaving ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
          Save session
        </button>
      </form>
    </article>
  );
}

function ChartSurface({
  children,
  className = '',
  height,
}: {
  children: (size: { width: number; height: number }) => ReactNode;
  className?: string;
  height: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    function updateWidth() {
      setWidth(Math.floor(frameRef.current?.getBoundingClientRect().width ?? 0));
    }

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    const frame = frameRef.current;
    if (frame) observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className={`chart-frame ${className}`} style={{ height }}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
