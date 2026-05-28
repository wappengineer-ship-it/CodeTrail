import { Router } from 'express';
import { prisma } from './prisma.js';
import { daysAgo, startOfWeek, toHours } from './dates.js';
import { goalCreateSchema, projectCreateSchema, sessionCreateSchema } from './validators.js';
import { env } from './env.js';
import { fallbackBootstrap, fallbackDashboard, fallbackWeeklySummary } from './fallbackData.js';

export const router = Router();

async function getDemoUser() {
  return prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
}

function isDevelopmentFallbackAllowed() {
  return env.NODE_ENV !== 'production';
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
      prisma.goal.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      prisma.codingSession.findMany({
        where: { userId: user.id },
        include: { project: true, technologies: { include: { technology: true } } },
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

    res.json({ user, technologies, projects, goals, recentCoding, recentLearning });
  } catch (error) {
    if (isDevelopmentFallbackAllowed()) {
      res.json(fallbackBootstrap);
      return;
    }
    next(error);
  }
});

router.get('/dashboard', async (_req, res, next) => {
  try {
    const user = await getDemoUser();
    const weekStart = startOfWeek();
    const monthStart = daysAgo(30);

    const [codingThisWeek, learningThisWeek, codingMonth, learningMonth, activeGoals, sessions] = await Promise.all([
      prisma.codingSession.aggregate({ where: { userId: user.id, sessionDate: { gte: weekStart } }, _sum: { minutes: true } }),
      prisma.learningSession.aggregate({ where: { userId: user.id, sessionDate: { gte: weekStart } }, _sum: { minutes: true } }),
      prisma.codingSession.aggregate({ where: { userId: user.id, sessionDate: { gte: monthStart } }, _sum: { minutes: true } }),
      prisma.learningSession.aggregate({ where: { userId: user.id, sessionDate: { gte: monthStart } }, _sum: { minutes: true } }),
      prisma.goal.findMany({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { dueDate: 'asc' } }),
      prisma.codingSession.findMany({
        where: { userId: user.id, sessionDate: { gte: daysAgo(45) } },
        include: { technologies: { include: { technology: true } } },
        orderBy: { sessionDate: 'asc' },
      }),
    ]);

    const days = new Map<string, number>();
    for (let index = 44; index >= 0; index -= 1) {
      const date = daysAgo(index);
      days.set(date.toISOString().slice(0, 10), 0);
    }

    const techMinutes = new Map<string, { name: string; color: string; minutes: number }>();
    sessions.forEach((session) => {
      const key = session.sessionDate.toISOString().slice(0, 10);
      days.set(key, (days.get(key) ?? 0) + session.minutes);
      session.technologies.forEach(({ technology }) => {
        const current = techMinutes.get(technology.id) ?? { name: technology.name, color: technology.color, minutes: 0 };
        current.minutes += session.minutes;
        techMinutes.set(technology.id, current);
      });
    });

    let streak = 0;
    for (const minutes of [...days.values()].reverse()) {
      if (minutes <= 0) break;
      streak += 1;
    }

    const chart = [...days.entries()].map(([date, minutes]) => ({ date, hours: toHours(minutes) }));
    const technologies = [...techMinutes.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6)
      .map((technology) => ({ ...technology, hours: toHours(technology.minutes) }));

    const weekMinutes = (codingThisWeek._sum.minutes ?? 0) + (learningThisWeek._sum.minutes ?? 0);
    const monthMinutes = (codingMonth._sum.minutes ?? 0) + (learningMonth._sum.minutes ?? 0);

    res.json({
      stats: {
        codingHoursThisWeek: toHours(codingThisWeek._sum.minutes ?? 0),
        learningHoursThisWeek: toHours(learningThisWeek._sum.minutes ?? 0),
        totalHoursLast30Days: toHours(monthMinutes),
        streakDays: Math.max(streak, 0),
        activeGoalCount: activeGoals.length,
      },
      chart,
      technologies,
      insights: [
        weekMinutes >= 600 ? 'Strong weekly momentum: you are already above 10 total hours.' : 'A focused two-hour block would noticeably lift this week.',
        technologies[0] ? `${technologies[0].name} is your strongest recent signal.` : 'Log a tech-tagged session to unlock technology insights.',
        activeGoals.some((goal) => goal.currentValue < goal.targetValue) ? 'At least one active goal still has room for progress.' : 'Your active goals are fully caught up.',
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
            create: input.technologyIds.map((technologyId) => ({ technologyId })),
          },
        },
        include: { project: true, technologies: { include: { technology: true } } },
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
      res.status(202).json({ ok: true, persisted: false, reason: 'Database is not ready in local development.' });
      return;
    }
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
      res.status(202).json({ ok: true, persisted: false, reason: 'Database is not ready in local development.' });
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
      res.status(202).json({ ok: true, persisted: false, reason: 'Database is not ready in local development.' });
      return;
    }
    next(error);
  }
});

router.post('/summaries/weekly', async (_req, res, next) => {
  try {
    const user = await getDemoUser();
    const weekStart = startOfWeek();
    const existing = await prisma.weeklySummary.findUnique({ where: { userId_weekStart: { userId: user.id, weekStart } } });
    if (existing) {
      res.json(existing);
      return;
    }

    const [coding, learning, goals] = await Promise.all([
      prisma.codingSession.findMany({ where: { userId: user.id, sessionDate: { gte: weekStart } }, include: { project: true } }),
      prisma.learningSession.findMany({ where: { userId: user.id, sessionDate: { gte: weekStart } } }),
      prisma.goal.findMany({ where: { userId: user.id, status: 'ACTIVE' } }),
    ]);

    const codingHours = toHours(coding.reduce((sum, session) => sum + session.minutes, 0));
    const learningHours = toHours(learning.reduce((sum, session) => sum + session.minutes, 0));
    const projectNames = [...new Set(coding.map((session) => session.project?.name).filter(Boolean))].join(', ') || 'independent practice';

    let content = `This week you logged ${codingHours} coding hours and ${learningHours} learning hours. Your strongest project focus was ${projectNames}. Next week, protect one deep-work block, ship one visible project increment, and keep notes on every concept that still feels fuzzy.`;

    if (env.OPENAI_API_KEY) {
      content = await generateAiSummary({ codingHours, learningHours, projectNames, goals: goals.map((goal) => goal.title) });
    }

    const summary = await prisma.weeklySummary.create({ data: { userId: user.id, weekStart, content } });
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
