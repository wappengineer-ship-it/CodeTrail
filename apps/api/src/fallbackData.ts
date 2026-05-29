import { daysAgo } from './dates.js';

const technologies = [
  { id: 'react', name: 'React', category: 'Frontend', color: '#2f80ed' },
  { id: 'ts', name: 'TypeScript', category: 'Language', color: '#1f5fbf' },
  { id: 'node', name: 'Node.js', category: 'Backend', color: '#3a8f5a' },
  { id: 'postgres', name: 'PostgreSQL', category: 'Database', color: '#7857d8' },
  { id: 'prisma', name: 'Prisma', category: 'ORM', color: '#c95f3f' },
  { id: 'css', name: 'CSS', category: 'Frontend', color: '#d49a2a' },
];

export const fallbackBootstrap = {
  user: { id: 'demo', name: 'Self-Taught Developer', email: 'demo@codetrail.dev' },
  technologies,
  projects: [
    {
      id: 'codetrail',
      name: 'CodeTrail',
      description: 'Flagship tracker for hours, learning, goals, streaks, projects, and weekly summaries.',
      status: 'active',
      technologies: technologies.slice(0, 5).map((technology) => ({ technology })),
    },
    {
      id: 'portfolio',
      name: 'Portfolio Refresh',
      description: 'A portfolio rebuild focused on stronger proof of skill.',
      status: 'planning',
      technologies: [technologies[0], technologies[5]].map((technology) => ({ technology })),
    },
  ],
  goals: [
    {
      id: 'weekly-hours',
      title: 'Log 12 focused work hours this week',
      description: 'Protect deep work blocks before adding new polish.',
      cadence: 'WEEKLY',
      status: 'ACTIVE',
      targetValue: 12,
      currentValue: 7,
      unit: 'hours',
    },
    {
      id: 'ship',
      title: 'Ship the first deployable milestone',
      cadence: 'MILESTONE',
      status: 'ACTIVE',
      targetValue: 1,
      currentValue: 0,
      unit: 'release',
    },
  ],
  recentCoding: [
    {
      id: 'coding-1',
      title: 'API routing and Prisma schema',
      minutes: 130,
      focusScore: 4,
      sessionDate: new Date().toISOString(),
      project: null,
      technologies: [technologies[2], technologies[1], technologies[4]].map((technology) => ({ technology })),
    },
  ],
  recentLearning: [
    {
      id: 'learning-1',
      topic: 'Prisma relation patterns',
      source: 'Docs and notes',
      minutes: 55,
      confidence: 4,
      sessionDate: new Date().toISOString(),
      technologies: [technologies[4], technologies[3]].map((technology) => ({ technology })),
    },
  ],
};

export const fallbackDashboard = {
  stats: {
    codingHoursToday: 1.4,
    learningHoursToday: 0.6,
    totalHoursToday: 2,
    codingHoursThisWeek: 7,
    learningHoursThisWeek: 2.7,
    totalHoursLast30Days: 28.5,
    streakDays: 4,
    activeGoalCount: 2,
  },
  chart: Array.from({ length: 14 }, (_, index) => ({
    date: daysAgo(13 - index).toISOString().slice(0, 10),
    hours: [0.5, 1.2, 0, 2.1, 1, 0.8, 0, 1.5, 2.3, 0.7, 1.4, 0, 1.8, 2.2][index],
  })),
  technologies: [
    { name: 'TypeScript', color: '#1f5fbf', minutes: 420, hours: 7 },
    { name: 'React', color: '#2f80ed', minutes: 330, hours: 5.5 },
    { name: 'Node.js', color: '#3a8f5a', minutes: 270, hours: 4.5 },
    { name: 'Prisma', color: '#c95f3f', minutes: 180, hours: 3 },
  ],
  insights: [
    'TypeScript is your strongest recent signal.',
    'A focused two-hour block would noticeably lift this week.',
    'Your flagship project has the clearest momentum right now.',
  ],
};

export function fallbackWeeklySummary() {
  return {
    id: 'fallback-summary',
    weekStart: new Date().toISOString(),
    content:
      'This week has a strong foundation: keep logging sessions, protect one deep-work block, and ship the next visible slice of your flagship project.',
    createdAt: new Date().toISOString(),
  };
}
