import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BookOpen,
  Brain,
  CalendarCheck,
  Code2,
  Flame,
  Goal,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  TimerReset,
} from 'lucide-react';
import { createSession, generateWeeklySummary, loadBootstrap, loadDashboard } from './api';
import type { BootstrapData, DashboardData } from './types';

type SessionMode = 'CODING' | 'LEARNING';

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [mode, setMode] = useState<SessionMode>('CODING');
  const [isSaving, setIsSaving] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [manualMinutes, setManualMinutes] = useState('60');
  const [summary, setSummary] = useState('');
  const timerStartedAt = useRef<number | null>(null);
  const elapsedBeforeStart = useRef(0);

  async function refresh() {
    const [bootstrapData, dashboardData] = await Promise.all([loadBootstrap(), loadDashboard()]);
    setBootstrap(bootstrapData);
    setDashboard(dashboardData);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!isTimerRunning || timerStartedAt.current === null) return;

    const intervalId = window.setInterval(() => {
      const secondsSinceStart = Math.floor((Date.now() - timerStartedAt.current!) / 1000);
      setElapsedSeconds(elapsedBeforeStart.current + secondsSinceStart);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isTimerRunning]);

  const firstProject = bootstrap?.projects[0];
  const firstTechnology = bootstrap?.technologies[0];

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bootstrap) return;

    const form = new FormData(event.currentTarget);
    const minutes = Number(form.get('minutes'));
    const title = String(form.get('title'));

    setIsSaving(true);
    try {
      await createSession({
        type: mode,
        title,
        topic: title,
        source: form.get('source') || 'Self study',
        minutes,
        notes: form.get('notes'),
        projectId: mode === 'CODING' ? form.get('projectId') || undefined : undefined,
        technologyIds: form.getAll('technologyIds'),
      });
      event.currentTarget.reset();
      resetTimer();
      setManualMinutes('60');
      await refresh();
    } catch {
      setSummary('The local API is not connected yet, so this session stayed in the browser preview. Once PostgreSQL is configured, saves will persist.');
    } finally {
      setIsSaving(false);
    }
  }

  function startTimer() {
    elapsedBeforeStart.current = elapsedSeconds;
    timerStartedAt.current = Date.now();
    setIsTimerRunning(true);
  }

  function stopTimer() {
    if (timerStartedAt.current !== null) {
      const secondsSinceStart = Math.floor((Date.now() - timerStartedAt.current) / 1000);
      const totalSeconds = elapsedBeforeStart.current + secondsSinceStart;
      setElapsedSeconds(totalSeconds);
      setManualMinutes(String(Math.max(5, Math.ceil(totalSeconds / 60))));
      elapsedBeforeStart.current = totalSeconds;
    }

    timerStartedAt.current = null;
    setIsTimerRunning(false);
  }

  function resetTimer() {
    timerStartedAt.current = null;
    elapsedBeforeStart.current = 0;
    setElapsedSeconds(0);
    setIsTimerRunning(false);
  }

  async function handleSummary() {
    try {
      const result = await generateWeeklySummary();
      setSummary(result.content);
    } catch {
      setSummary('This week has a strong foundation: keep logging sessions, protect one deep-work block, and ship the next visible slice of your flagship project.');
    }
  }

  const recentActivity = useMemo(() => {
    if (!bootstrap) return [];
    return [
      ...bootstrap.recentCoding.map((session) => ({
        id: session.id,
        kind: 'Coding',
        title: session.title,
        minutes: session.minutes,
        date: session.sessionDate,
      })),
      ...bootstrap.recentLearning.map((session) => ({
        id: session.id,
        kind: 'Learning',
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
          <button className="summary-button" onClick={handleSummary}>
            <Sparkles size={18} />
            Weekly summary
          </button>
        </header>

        <section className="today-summary" aria-label="Today summary">
          <div>
            <p className="eyebrow">Total today</p>
            <strong>{formatHours(todayTotalHours)}h</strong>
          </div>
          <dl>
            <div>
              <dt>Coding</dt>
              <dd>{formatHours(todayCodingHours)}h</dd>
            </div>
            <div>
              <dt>Learning</dt>
              <dd>{formatHours(todayLearningHours)}h</dd>
            </div>
          </dl>
        </section>

        <section id="dashboard" className="stats-grid">
          <Metric icon={<Code2 />} label="Coding week" value={`${dashboard.stats.codingHoursThisWeek}h`} />
          <Metric icon={<BookOpen />} label="Learning week" value={`${dashboard.stats.learningHoursThisWeek}h`} />
          <Metric icon={<Flame />} label="Current streak" value={`${dashboard.stats.streakDays}d`} />
          <Metric icon={<CalendarCheck />} label="Last 30 days" value={`${dashboard.stats.totalHoursLast30Days}h`} />
        </section>

        {summary && (
          <section className="ai-band">
            <Sparkles size={20} />
            <p>{summary}</p>
          </section>
        )}

        <section className="main-grid">
          <article className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Momentum</p>
                <h2>Daily coding hours</h2>
              </div>
            </div>
            <ChartSurface height={290}>
              {({ width, height }) => (
                <AreaChart width={width} height={height} data={dashboard.chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d7dde8" />
                  <XAxis dataKey="date" tickFormatter={(date) => date.slice(5)} tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Area type="monotone" dataKey="hours" stroke="#2f80ed" fill="#b9d7ff" strokeWidth={2} />
                </AreaChart>
              )}
            </ChartSurface>
          </article>

          <article id="sessions" className="panel log-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Quick log</p>
                <h2>Add a session</h2>
              </div>
              <div className="segmented" aria-label="Session type">
                <button className={mode === 'CODING' ? 'selected' : ''} onClick={() => setMode('CODING')}>
                  <Code2 size={16} /> Code
                </button>
                <button className={mode === 'LEARNING' ? 'selected' : ''} onClick={() => setMode('LEARNING')}>
                  <BookOpen size={16} /> Learn
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="session-form">
              <div className="timer-card">
                <div>
                  <span>Timer</span>
                  <strong>{formatDuration(elapsedSeconds)}</strong>
                </div>
                <div className="timer-actions">
                  <button type="button" className="icon-button start" onClick={startTimer} disabled={isTimerRunning} aria-label="Start timer" title="Start timer">
                    <Play size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button stop"
                    onClick={stopTimer}
                    disabled={!isTimerRunning && elapsedSeconds === 0}
                    aria-label="Stop timer"
                    title="Stop timer"
                  >
                    <Square size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={resetTimer}
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
                <input
                  name="minutes"
                  type="number"
                  min="5"
                  max="1440"
                  value={manualMinutes}
                  onChange={(event) => setManualMinutes(event.target.value)}
                  required
                />
              </label>

              <details className="optional-details">
                <summary>Details</summary>
                <div className="details-fields">
                  <label>
                    <span>{mode === 'CODING' ? 'Session title' : 'Topic'}</span>
                    <input key={mode} name="title" defaultValue={mode === 'CODING' ? 'Coding session' : 'Learning session'} required />
                  </label>

                  <div className="form-row">
                    {mode === 'CODING' ? (
                      <label>
                        <span>Project</span>
                        <select name="projectId" defaultValue={firstProject?.id}>
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
                        <input name="source" defaultValue="Docs and practice" />
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
                            defaultChecked={technology.id === firstTechnology?.id}
                          />
                          {technology.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label>
                    <span>Notes</span>
                    <textarea name="notes" rows={3} placeholder="What moved forward? What felt sticky?" />
                  </label>
                </div>
              </details>

              <button className="primary-button" disabled={isSaving}>
                {isSaving ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
                Save session
              </button>
            </form>
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
            <ul className="insight-list">
              {dashboard.insights.map((insight) => (
                <li key={insight}>
                  <Brain size={17} />
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
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
                  <time>{Math.round(activity.minutes / 60 * 10) / 10}h</time>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
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
