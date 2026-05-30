import { Router } from 'express';
import { prisma } from './prisma.js';
import { daysAgo, startOfDay, startOfWeek, toHours } from './dates.js';
import {
  authSchema,
  goalCreateSchema,
  projectCreateSchema,
  registerSchema,
  sessionCreateSchema,
  sessionDeleteSchema,
  sessionUpdateSchema,
  technologyCreateSchema,
  technologyUpdateSchema,
} from './validators.js';
import { env } from './env.js';
import { fallbackBootstrap, fallbackDashboard, fallbackWeeklySummary } from './fallbackData.js';
import { rateLimit } from './rateLimit.js';
import {
  type AuthenticatedRequest,
  clearSessionCookie,
  createAuthSession,
  destroyAuthSession,
  hashPassword,
  requireAuth,
  setSessionCookie,
  toPublicUser,
  verifyPassword,
} from './auth.js';

export const router = Router();
const dashboardRanges = ['today', 'week', 'month', 'all'] as const;
const authRateLimit = rateLimit({ limit: 5, windowMs: 15 * 60 * 1000 });
const demoRateLimit = rateLimit({ limit: 20, windowMs: 15 * 60 * 1000 });
type DashboardRange = (typeof dashboardRanges)[number];

function getCurrentUser(req: Parameters<typeof requireAuth>[0]) {
  return (req as unknown as AuthenticatedRequest).user;
}

function isDevelopmentFallbackAllowed() {
  return env.NODE_ENV !== 'production';
}

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: getCurrentUser(req) });
});

router.post('/auth/register', authRateLimit, async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      res.status(409).json({ error: 'An account with that email already exists' });
      return;
    }

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        timezone: 'Africa/Johannesburg',
      },
    });
    const token = await createAuthSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/login', authRateLimit, async (req, res, next) => {
  try {
    const input = authSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const isValidPassword = await verifyPassword(input.password, user?.passwordHash ?? null);

    if (!user || !isValidPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = await createAuthSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/demo', demoRateLimit, async (_req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: 'demo@codetrail.dev' } });
    if (!user) {
      res.status(404).json({ error: 'Demo account is not available yet' });
      return;
    }

    const token = await createAuthSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', async (req, res, next) => {
  try {
    await destroyAuthSession(req);
    clearSessionCookie(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);

function startOfMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function resolveDashboardRange(value: unknown): {
  label: string;
  range: DashboardRange;
  startDate?: Date;
} {
  const range = dashboardRanges.includes(value as DashboardRange) ? (value as DashboardRange) : 'week';

  if (range === 'today') return { label: 'Today', range, startDate: startOfDay() };
  if (range === 'month') return { label: 'This month', range, startDate: startOfMonth() };
  if (range === 'all') return { label: 'All time', range };

  return { label: 'This week', range, startDate: startOfWeek() };
}

function buildDayKeys(startDate: Date, endDate = new Date()) {
  const days: string[] = [];
  const cursor = startOfDay(startDate);
  const end = startOfDay(endDate);

  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

async function validateTechnologyIds(userId: string, technologyIds: string[]) {
  const uniqueTechnologyIds = [...new Set(technologyIds)];
  if (uniqueTechnologyIds.length === 0) return [];

  const count = await prisma.technology.count({
    where: {
      id: { in: uniqueTechnologyIds },
      userId,
    },
  });

  if (count !== uniqueTechnologyIds.length) {
    throw new Error('Invalid technology selection');
  }

  return uniqueTechnologyIds;
}

async function advanceHourGoals(input: { minutes: number; userId: string }) {
  const hours = toHours(input.minutes);
  if (hours <= 0) return;

  const goals = await prisma.goal.findMany({
    where: {
      userId: input.userId,
      status: 'ACTIVE',
      unit: { equals: 'hours', mode: 'insensitive' },
    },
  });

  await Promise.all(
    goals.map((goal) =>
      prisma.goal.update({
        where: { id: goal.id },
        data: { currentValue: Math.min(goal.targetValue, goal.currentValue + hours) },
      }),
    ),
  );
}

router.get('/bootstrap', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const [technologies, projects, goals, recentCoding, recentLearning] = await Promise.all([
      prisma.technology.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } }),
      prisma.project.findMany({
        where: { userId: user.id },
        include: { technologies: { include: { technology: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.goal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.codingSession.findMany({
        where: { userId: user.id },
        include: {
          project: true,
          technologies: { include: { technology: true } },
        },
        orderBy: { sessionDate: 'desc' },
        take: 8,
      }),
      prisma.learningSession.findMany({
        where: { userId: user.id },
        include: { technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'desc' },
        take: 8,
      }),
    ]);

    res.json({
      user,
      technologies,
      projects,
      goals,
      recentCoding,
      recentLearning,
    });
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.json(fallbackBootstrap);
      return;
    }
    next(error);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const todayStart = startOfDay();
    const weekStart = startOfWeek();
    const monthStart = daysAgo(30);
    const selectedRange = resolveDashboardRange(req.query.range);
    const rangeDateFilter = selectedRange.startDate ? { gte: selectedRange.startDate } : undefined;

    const [
      codingToday,
      learningToday,
      codingThisWeek,
      learningThisWeek,
      codingMonth,
      learningMonth,
      rangeCoding,
      rangeLearning,
      activeGoals,
      recentCodingSessions,
      recentLearningSessions,
    ] = await Promise.all([
      prisma.codingSession.aggregate({
        where: { userId: user.id, sessionDate: { gte: todayStart } },
        _sum: { minutes: true },
      }),
      prisma.learningSession.aggregate({
        where: { userId: user.id, sessionDate: { gte: todayStart } },
        _sum: { minutes: true },
      }),
      prisma.codingSession.aggregate({
        where: { userId: user.id, sessionDate: { gte: weekStart } },
        _sum: { minutes: true },
      }),
      prisma.learningSession.aggregate({
        where: { userId: user.id, sessionDate: { gte: weekStart } },
        _sum: { minutes: true },
      }),
      prisma.codingSession.aggregate({
        where: { userId: user.id, sessionDate: { gte: monthStart } },
        _sum: { minutes: true },
      }),
      prisma.learningSession.aggregate({
        where: { userId: user.id, sessionDate: { gte: monthStart } },
        _sum: { minutes: true },
      }),
      prisma.codingSession.findMany({
        where: { userId: user.id, sessionDate: rangeDateFilter },
        include: { technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'asc' },
      }),
      prisma.learningSession.findMany({
        where: { userId: user.id, sessionDate: rangeDateFilter },
        include: { technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'asc' },
      }),
      prisma.goal.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.codingSession.findMany({
        where: { userId: user.id, sessionDate: { gte: daysAgo(45) } },
        include: { technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'asc' },
      }),
      prisma.learningSession.findMany({
        where: { userId: user.id, sessionDate: { gte: daysAgo(45) } },
        include: { technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'asc' },
      }),
    ]);

    const allRangeSessions = [...rangeCoding, ...rangeLearning].sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
    const firstRangeDate = allRangeSessions[0]?.sessionDate ?? daysAgo(44);
    const historyStart = selectedRange.startDate ?? firstRangeDate;
    const days = new Map<string, { coding: number; learning: number }>();
    buildDayKeys(historyStart).forEach((date) => days.set(date, { coding: 0, learning: 0 }));

    const techMinutes = new Map<string, { name: string; color: string; minutes: number }>();
    function addTechnologyMinutes(session: { minutes: number; technologies: { technology: { id: string; name: string; color: string } }[] }) {
      session.technologies.forEach(({ technology }) => {
        const current = techMinutes.get(technology.id) ?? {
          name: technology.name,
          color: technology.color,
          minutes: 0,
        };
        current.minutes += session.minutes;
        techMinutes.set(technology.id, current);
      });
    }

    rangeCoding.forEach((session) => {
      const key = session.sessionDate.toISOString().slice(0, 10);
      const current = days.get(key) ?? { coding: 0, learning: 0 };
      current.coding += session.minutes;
      days.set(key, current);
      addTechnologyMinutes(session);
    });
    rangeLearning.forEach((session) => {
      const key = session.sessionDate.toISOString().slice(0, 10);
      const current = days.get(key) ?? { coding: 0, learning: 0 };
      current.learning += session.minutes;
      days.set(key, current);
      addTechnologyMinutes(session);
    });

    let streak = 0;
    const streakDays = new Map<string, number>();
    buildDayKeys(daysAgo(44)).forEach((date) => streakDays.set(date, 0));
    [...recentCodingSessions, ...recentLearningSessions].forEach((session) => {
      const key = session.sessionDate.toISOString().slice(0, 10);
      streakDays.set(key, (streakDays.get(key) ?? 0) + session.minutes);
    });
    for (const minutes of [...streakDays.values()].reverse()) {
      if (minutes <= 0) break;
      streak += 1;
    }

    const history = [...days.entries()]
      .map(([date, minutes]) => ({
        date,
        codingHours: toHours(minutes.coding),
        learningHours: toHours(minutes.learning),
        totalHours: toHours(minutes.coding + minutes.learning),
      }))
      .filter((day) => selectedRange.range !== 'all' || day.totalHours > 0)
      .reverse();
    const chart = [...history].reverse().map((day) => ({ date: day.date, hours: day.totalHours }));
    const technologies = [...techMinutes.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6)
      .map((technology) => ({
        ...technology,
        hours: toHours(technology.minutes),
      }));

    const weekMinutes = (codingThisWeek._sum.minutes ?? 0) + (learningThisWeek._sum.minutes ?? 0);
    const monthMinutes = (codingMonth._sum.minutes ?? 0) + (learningMonth._sum.minutes ?? 0);
    const todayMinutes = (codingToday._sum.minutes ?? 0) + (learningToday._sum.minutes ?? 0);
    const rangeCodingMinutes = rangeCoding.reduce((sum, session) => sum + session.minutes, 0);
    const rangeLearningMinutes = rangeLearning.reduce((sum, session) => sum + session.minutes, 0);
    const rangeMinutes = rangeCodingMinutes + rangeLearningMinutes;

    res.json({
      stats: {
        codingHoursToday: toHours(codingToday._sum.minutes ?? 0),
        learningHoursToday: toHours(learningToday._sum.minutes ?? 0),
        totalHoursToday: toHours(todayMinutes),
        rangeCodingHours: toHours(rangeCodingMinutes),
        rangeLearningHours: toHours(rangeLearningMinutes),
        rangeTotalHours: toHours(rangeMinutes),
        rangeLabel: selectedRange.label,
        codingHoursThisWeek: toHours(codingThisWeek._sum.minutes ?? 0),
        learningHoursThisWeek: toHours(learningThisWeek._sum.minutes ?? 0),
        totalHoursLast30Days: toHours(monthMinutes),
        streakDays: Math.max(streak, 0),
        activeGoalCount: activeGoals.length,
      },
      chart,
      history,
      technologies,
      insights: [
        rangeMinutes >= 600
          ? `${selectedRange.label} is already above 10 total hours.`
          : `A focused two-hour block would noticeably lift ${selectedRange.label.toLowerCase()}.`,
        technologies[0] ? `${technologies[0].name} is your strongest recent signal.` : 'Log a tech-tagged session to unlock technology insights.',
        activeGoals.some((goal) => goal.currentValue < goal.targetValue)
          ? 'At least one active goal still has room for progress.'
          : 'Your active goals are fully caught up.',
      ],
    });
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.json(fallbackDashboard);
      return;
    }
    next(error);
  }
});

router.get('/technologies', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const technologies = await prisma.technology.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });
    res.json(technologies);
  } catch (error) {
    next(error);
  }
});

router.post('/technologies', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const input = technologyCreateSchema.parse(req.body);
    const existing = await prisma.technology.findUnique({
      where: { userId_name: { userId: user.id, name: input.name } },
    });
    if (existing) {
      res.status(409).json({ error: 'Technology already exists' });
      return;
    }

    const technology = await prisma.technology.create({
      data: {
        userId: user.id,
        name: input.name,
        category: input.category,
        color: input.color,
      },
    });
    res.status(201).json(technology);
  } catch (error) {
    next(error);
  }
});

router.patch('/technologies/:id', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const input = technologyUpdateSchema.parse({ ...req.body, id: req.params.id });
    const existing = await prisma.technology.findUnique({
      where: { userId_name: { userId: user.id, name: input.name } },
    });
    if (existing && existing.id !== input.id) {
      res.status(409).json({ error: 'Technology already exists' });
      return;
    }

    const technology = await prisma.technology.update({
      where: { id: input.id, userId: user.id },
      data: {
        name: input.name,
        category: input.category,
        color: input.color,
      },
    });
    res.json(technology);
  } catch (error) {
    next(error);
  }
});

router.delete('/technologies/:id', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const id = String(req.params.id);
    const usageCount = await Promise.all([
      prisma.projectTechnology.count({ where: { technologyId: id, project: { userId: user.id } } }),
      prisma.codingSessionTechnology.count({ where: { technologyId: id, codingSession: { userId: user.id } } }),
      prisma.learningSessionTechnology.count({ where: { technologyId: id, learningSession: { userId: user.id } } }),
    ]);

    if (usageCount.some((count) => count > 0)) {
      res.status(409).json({ error: 'Technology is already used by projects or sessions' });
      return;
    }

    await prisma.technology.delete({ where: { id, userId: user.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const input = sessionCreateSchema.parse(req.body);
    const technologyIds = await validateTechnologyIds(user.id, input.technologyIds);
    const sessionDate = input.sessionDate ? new Date(input.sessionDate) : new Date();

    if (input.type === 'CODING') {
      const session = await prisma.codingSession.create({
        data: {
          userId: user.id,
          projectId: input.projectId,
          title: input.title,
          notes: input.notes,
          minutes: input.minutes,
          focusScore: input.focusScore ?? 3,
          sessionDate,
          technologies: {
            create: technologyIds.map((technologyId) => ({
              technologyId,
            })),
          },
        },
        include: {
          project: true,
          technologies: { include: { technology: true } },
        },
      });
      await advanceHourGoals({ minutes: input.minutes, userId: user.id });
      res.status(201).json(session);
      return;
    }

    const session = await prisma.learningSession.create({
      data: {
        userId: user.id,
        topic: input.topic ?? input.title,
        source: input.source ?? 'Self study',
        notes: input.notes,
        minutes: input.minutes,
        confidence: input.confidence ?? 3,
        sessionDate,
        technologies: {
          create: technologyIds.map((technologyId) => ({ technologyId })),
        },
      },
      include: { technologies: { include: { technology: true } } },
    });
    await advanceHourGoals({ minutes: input.minutes, userId: user.id });
    res.status(201).json(session);
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.status(202).json({
        ok: true,
        persisted: false,
        reason: 'Database is not ready in local development.',
      });
      return;
    }
    next(error);
  }
});

router.delete('/sessions/:type/:id', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const input = sessionDeleteSchema.parse({
      id: req.params.id,
      type: req.params.type,
    });

    if (input.type === 'CODING') {
      await prisma.codingSession.delete({
        where: { id: input.id, userId: user.id },
      });
      res.status(204).send();
      return;
    }

    await prisma.learningSession.delete({
      where: { id: input.id, userId: user.id },
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.patch('/sessions/:type/:id', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const input = sessionUpdateSchema.parse({
      ...req.body,
      id: req.params.id,
      type: req.params.type,
    });

    if (input.type === 'CODING') {
      const session = await prisma.codingSession.update({
        where: { id: input.id, userId: user.id },
        data: { title: input.title, minutes: input.minutes },
      });
      res.json(session);
      return;
    }

    const session = await prisma.learningSession.update({
      where: { id: input.id, userId: user.id },
      data: { topic: input.title, minutes: input.minutes },
    });
    res.json(session);
  } catch (error) {
    next(error);
  }
});

router.post('/projects', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const input = projectCreateSchema.parse(req.body);
    const technologyIds = await validateTechnologyIds(user.id, input.technologyIds);
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: input.name,
        description: input.description,
        status: input.status,
        repository: input.repository || undefined,
        liveUrl: input.liveUrl || undefined,
        startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
        technologies: {
          create: technologyIds.map((technologyId) => ({ technologyId })),
        },
      },
      include: { technologies: { include: { technology: true } } },
    });
    res.status(201).json(project);
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.status(202).json({
        ok: true,
        persisted: false,
        reason: 'Database is not ready in local development.',
      });
      return;
    }
    next(error);
  }
});

router.post('/goals', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const input = goalCreateSchema.parse(req.body);
    const goal = await prisma.goal.create({
      data: {
        userId: user.id,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        cadence: input.cadence,
        targetValue: input.targetValue,
        currentValue: input.currentValue,
        unit: input.unit,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      },
    });
    res.status(201).json(goal);
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.status(202).json({
        ok: true,
        persisted: false,
        reason: 'Database is not ready in local development.',
      });
      return;
    }
    next(error);
  }
});

router.post('/summaries/weekly', async (req, res, next) => {
  try {
    const user = getCurrentUser(req);
    const weekStart = startOfWeek();

    const [coding, learning, goals, recentCoding, recentLearning] = await Promise.all([
      prisma.codingSession.findMany({
        where: { userId: user.id, sessionDate: { gte: weekStart } },
        include: { project: true, technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'desc' },
      }),
      prisma.learningSession.findMany({
        where: { userId: user.id, sessionDate: { gte: weekStart } },
        include: { technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'desc' },
      }),
      prisma.goal.findMany({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { dueDate: 'asc' } }),
      prisma.codingSession.findMany({
        where: { userId: user.id, sessionDate: { gte: daysAgo(45) } },
        select: { minutes: true, sessionDate: true },
      }),
      prisma.learningSession.findMany({
        where: { userId: user.id, sessionDate: { gte: daysAgo(45) } },
        select: { minutes: true, sessionDate: true },
      }),
    ]);

    const codingMinutes = coding.reduce((sum, session) => sum + session.minutes, 0);
    const learningMinutes = learning.reduce((sum, session) => sum + session.minutes, 0);
    const codingHours = toHours(codingMinutes);
    const learningHours = toHours(learningMinutes);
    const totalHours = toHours(codingMinutes + learningMinutes);
    const projectNames = [...new Set(coding.map((session) => session.project?.name).filter(Boolean))].join(', ') || 'independent practice';
    const topTechnologies = summarizeTechnologies([
      ...coding.map((session) => ({ minutes: session.minutes, technologies: session.technologies })),
      ...learning.map((session) => ({ minutes: session.minutes, technologies: session.technologies })),
    ]);
    const recentSessions = [
      ...coding.map((session) => ({
        title: session.title,
        type: 'Work',
        hours: toHours(session.minutes),
        date: session.sessionDate.toISOString().slice(0, 10),
      })),
      ...learning.map((session) => ({
        title: session.topic,
        type: 'Learning',
        hours: toHours(session.minutes),
        date: session.sessionDate.toISOString().slice(0, 10),
      })),
    ]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 6);
    const streakDays = calculateStreak([...recentCoding, ...recentLearning]);
    const goalProgress = goals.map((goal) => ({
      title: goal.title,
      current: goal.currentValue,
      target: goal.targetValue,
      unit: goal.unit,
      percent: Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)),
    }));

    let content = buildFallbackAiSummary({
      codingHours,
      goalProgress,
      learningHours,
      projectNames,
      recentSessions,
      streakDays,
      topTechnologies,
      totalHours,
    });

    if (env.OPENAI_API_KEY) {
      content = await generateAiSummary({
        codingHours,
        goalProgress,
        learningHours,
        projectNames,
        recentSessions,
        streakDays,
        topTechnologies,
        totalHours,
      });
    }

    const summary = await prisma.weeklySummary.upsert({
      where: { userId_weekStart: { userId: user.id, weekStart } },
      create: { userId: user.id, weekStart, content },
      update: { content },
    });
    res.json(summary);
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.json(fallbackWeeklySummary());
      return;
    }
    next(error);
  }
});

type AiSummaryInput = {
  codingHours: number;
  goalProgress: { current: number; percent: number; target: number; title: string; unit: string }[];
  learningHours: number;
  projectNames: string;
  recentSessions: { date: string; hours: number; title: string; type: string }[];
  streakDays: number;
  topTechnologies: { hours: number; name: string }[];
  totalHours: number;
};

function summarizeTechnologies(
  sessions: { minutes: number; technologies: { technology: { id: string; name: string } }[] }[],
) {
  const techMinutes = new Map<string, { minutes: number; name: string }>();

  sessions.forEach((session) => {
    session.technologies.forEach(({ technology }) => {
      const current = techMinutes.get(technology.id) ?? { minutes: 0, name: technology.name };
      current.minutes += session.minutes;
      techMinutes.set(technology.id, current);
    });
  });

  return [...techMinutes.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5)
    .map((technology) => ({
      name: technology.name,
      hours: toHours(technology.minutes),
    }));
}

function calculateStreak(sessions: { minutes: number; sessionDate: Date }[]) {
  let streak = 0;
  const days = new Map<string, number>();
  buildDayKeys(daysAgo(44)).forEach((date) => days.set(date, 0));

  sessions.forEach((session) => {
    const key = session.sessionDate.toISOString().slice(0, 10);
    days.set(key, (days.get(key) ?? 0) + session.minutes);
  });

  for (const minutes of [...days.values()].reverse()) {
    if (minutes <= 0) break;
    streak += 1;
  }

  return streak;
}

function buildFallbackAiSummary(input: AiSummaryInput) {
  const topTechnology = input.topTechnologies[0]?.name ?? 'your core stack';
  const activeGoal = input.goalProgress[0];
  const goalSentence = activeGoal
    ? `${activeGoal.title} is ${activeGoal.percent}% complete at ${activeGoal.current}/${activeGoal.target} ${activeGoal.unit}.`
    : 'Set one small weekly goal to make next week easier to steer.';
  const nextAction =
    input.totalHours >= 10
      ? 'Next, protect one recovery block and choose one visible project increment to ship.'
      : 'Next, schedule one focused two-hour block and tag the technologies you use.';

  return `This week you logged ${input.totalHours} total hours: ${input.codingHours} work and ${input.learningHours} learning. Your strongest signal is ${topTechnology}, with project focus on ${input.projectNames}. Your current streak is ${input.streakDays} day${input.streakDays === 1 ? '' : 's'}. ${goalSentence} ${nextAction}`;
}

async function generateAiSummary(input: AiSummaryInput) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content:
            'Write concise weekly coaching summaries for self-taught developers. Use the provided metrics. Mention total hours, one pattern, one goal or streak signal, and one practical next action. Keep it under 90 words.',
        },
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
    }),
  });

  if (!response.ok) {
    return buildFallbackAiSummary(input);
  }

  const json = (await response.json()) as { output_text?: string };
  return json.output_text?.trim() || buildFallbackAiSummary(input);
}
