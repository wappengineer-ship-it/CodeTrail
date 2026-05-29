import { Router } from 'express';
import { prisma } from './prisma.js';
import { daysAgo, startOfDay, startOfWeek, toHours } from './dates.js';
import { goalCreateSchema, projectCreateSchema, sessionCreateSchema, sessionDeleteSchema, sessionUpdateSchema } from './validators.js';
import { env } from './env.js';
import { fallbackBootstrap, fallbackDashboard, fallbackWeeklySummary } from './fallbackData.js';

export const router = Router();
const dashboardRanges = ['today', 'week', 'month', 'all'] as const;
type DashboardRange = (typeof dashboardRanges)[number];

async function getDemoUser() {
  return prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
}

function isDevelopmentFallbackAllowed() {
  return env.NODE_ENV !== 'production';
}

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

router.get('/bootstrap', async (_req, res, next) => {
  try {
    const user = await getDemoUser();
    const [technologies, projects, goals, recentCoding, recentLearning] = await Promise.all([
      prisma.technology.findMany({ orderBy: { name: 'asc' } }),
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
    const user = await getDemoUser();
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
        orderBy: { sessionDate: 'asc' },
      }),
    ]);

    const allRangeSessions = [...rangeCoding, ...rangeLearning].sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
    const firstRangeDate = allRangeSessions[0]?.sessionDate ?? daysAgo(44);
    const historyStart = selectedRange.startDate ?? firstRangeDate;
    const days = new Map<string, { coding: number; learning: number }>();
    buildDayKeys(historyStart).forEach((date) => days.set(date, { coding: 0, learning: 0 }));

    const techMinutes = new Map<string, { name: string; color: string; minutes: number }>();
    rangeCoding.forEach((session) => {
      const key = session.sessionDate.toISOString().slice(0, 10);
      const current = days.get(key) ?? { coding: 0, learning: 0 };
      current.coding += session.minutes;
      days.set(key, current);
      session.technologies.forEach(({ technology }) => {
        const current = techMinutes.get(technology.id) ?? {
          name: technology.name,
          color: technology.color,
          minutes: 0,
        };
        current.minutes += session.minutes;
        techMinutes.set(technology.id, current);
      });
    });
    rangeLearning.forEach((session) => {
      const key = session.sessionDate.toISOString().slice(0, 10);
      const current = days.get(key) ?? { coding: 0, learning: 0 };
      current.learning += session.minutes;
      days.set(key, current);
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

router.post('/sessions', async (req, res, next) => {
  try {
    const user = await getDemoUser();
    const input = sessionCreateSchema.parse(req.body);
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
            create: input.technologyIds.map((technologyId) => ({
              technologyId,
            })),
          },
        },
        include: {
          project: true,
          technologies: { include: { technology: true } },
        },
      });
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
          create: input.technologyIds.map((technologyId) => ({ technologyId })),
        },
      },
      include: { technologies: { include: { technology: true } } },
    });
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
    const user = await getDemoUser();
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
    const user = await getDemoUser();
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
    const user = await getDemoUser();
    const input = projectCreateSchema.parse(req.body);
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
          create: input.technologyIds.map((technologyId) => ({ technologyId })),
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
    const user = await getDemoUser();
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

router.post('/summaries/weekly', async (_req, res, next) => {
  try {
    const user = await getDemoUser();
    const weekStart = startOfWeek();
    const existing = await prisma.weeklySummary.findUnique({
      where: { userId_weekStart: { userId: user.id, weekStart } },
    });
    if (existing) {
      res.json(existing);
      return;
    }

    const [coding, learning, goals] = await Promise.all([
      prisma.codingSession.findMany({
        where: { userId: user.id, sessionDate: { gte: weekStart } },
        include: { project: true },
      }),
      prisma.learningSession.findMany({
        where: { userId: user.id, sessionDate: { gte: weekStart } },
      }),
      prisma.goal.findMany({ where: { userId: user.id, status: 'ACTIVE' } }),
    ]);

    const codingHours = toHours(coding.reduce((sum, session) => sum + session.minutes, 0));
    const learningHours = toHours(learning.reduce((sum, session) => sum + session.minutes, 0));
    const projectNames = [...new Set(coding.map((session) => session.project?.name).filter(Boolean))].join(', ') || 'independent practice';

    let content = `This week you logged ${codingHours} coding hours and ${learningHours} learning hours. Your strongest project focus was ${projectNames}. Next week, protect one deep-work block, ship one visible project increment, and keep notes on every concept that still feels fuzzy.`;

    if (env.OPENAI_API_KEY) {
      content = await generateAiSummary({
        codingHours,
        learningHours,
        projectNames,
        goals: goals.map((goal) => goal.title),
      });
    }

    const summary = await prisma.weeklySummary.create({
      data: { userId: user.id, weekStart, content },
    });
    res.status(201).json(summary);
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.json(fallbackWeeklySummary());
      return;
    }
    next(error);
  }
});

async function generateAiSummary(input: { codingHours: number; learningHours: number; projectNames: string; goals: string[] }) {
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
          content: 'Write concise weekly coaching summaries for self-taught developers. Be specific, encouraging, and practical.',
        },
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
    }),
  });

  if (!response.ok) {
    return `This week you logged ${input.codingHours} coding hours and ${input.learningHours} learning hours. Keep the next step small, visible, and shippable.`;
  }

  const json = (await response.json()) as { output_text?: string };
  return json.output_text?.trim() || `This week you logged ${input.codingHours} coding hours and ${input.learningHours} learning hours.`;
}
