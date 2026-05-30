import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

const technologies = [
  { name: 'React', category: 'Frontend', color: '#2f80ed' },
  { name: 'TypeScript', category: 'Language', color: '#1f5fbf' },
  { name: 'Node.js', category: 'Backend', color: '#3a8f5a' },
  { name: 'PostgreSQL', category: 'Database', color: '#7857d8' },
  { name: 'Prisma', category: 'ORM', color: '#c95f3f' },
  { name: 'CSS', category: 'Frontend', color: '#d49a2a' },
];

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@codetrail.dev' },
    update: { passwordHash: hashPassword('codetrail-demo') },
    create: {
      name: 'Self-Taught Developer',
      email: 'demo@codetrail.dev',
      passwordHash: hashPassword('codetrail-demo'),
      timezone: 'Africa/Johannesburg',
    },
  });

  const techRecords = await Promise.all(
    technologies.map((technology) =>
      prisma.technology.upsert({
        where: { userId_name: { userId: user.id, name: technology.name } },
        update: technology,
        create: { ...technology, userId: user.id },
      }),
    ),
  );

  const byName = new Map(techRecords.map((technology) => [technology.name, technology]));
  const react = byName.get('React')!;
  const typescript = byName.get('TypeScript')!;
  const node = byName.get('Node.js')!;
  const postgres = byName.get('PostgreSQL')!;
  const prismaTech = byName.get('Prisma')!;
  const css = byName.get('CSS')!;

  const shouldResetDemoData = process.env.RESET_SEED === 'true' || process.env.NODE_ENV !== 'production';
  const existingProjectCount = await prisma.project.count({ where: { userId: user.id } });

  if (shouldResetDemoData) {
    await prisma.$transaction([
      prisma.weeklySummary.deleteMany({ where: { userId: user.id } }),
      prisma.goal.deleteMany({ where: { userId: user.id } }),
      prisma.codingSession.deleteMany({ where: { userId: user.id } }),
      prisma.learningSession.deleteMany({ where: { userId: user.id } }),
      prisma.project.deleteMany({ where: { userId: user.id } }),
    ]);
  } else if (existingProjectCount > 0) {
    return;
  }

  const codeTrail = await prisma.project.create({
    data: {
      userId: user.id,
      name: 'CodeTrail',
      description: 'Flagship tracker for work hours, learning progress, goals, streaks, projects, and weekly summaries.',
      status: 'active',
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 21),
      technologies: {
        create: [react, typescript, node, postgres, prismaTech].map((technology) => ({ technologyId: technology.id })),
      },
    },
  });

  await prisma.project.create({
    data: {
      userId: user.id,
      name: 'Portfolio Refresh',
      description: 'A portfolio rebuild focused on clearer case studies and stronger proof of skill.',
      status: 'planning',
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
      technologies: {
        create: [react, css].map((technology) => ({ technologyId: technology.id })),
      },
    },
  });

  const codingSessions = [
    ['API routing and Prisma schema', 130, 1, [node, typescript, prismaTech]],
    ['Dashboard cards and chart pass', 95, 2, [react, typescript, css]],
    ['Database relationship modeling', 80, 4, [postgres, prismaTech]],
    ['Form validation flow', 70, 6, [react, typescript]],
    ['Render deploy planning', 45, 8, [node, postgres]],
  ] as const;

  for (const [title, minutes, daysAgo, techs] of codingSessions) {
    await prisma.codingSession.create({
      data: {
        userId: user.id,
        projectId: codeTrail.id,
        title,
        minutes,
        focusScore: 4,
        notes: 'Seeded milestone session.',
        sessionDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * daysAgo),
        technologies: {
          create: techs.map((technology) => ({ technologyId: technology.id })),
        },
      },
    });
  }

  const learningSessions = [
    ['Prisma relation patterns', 'Docs and notes', 55, 1, [prismaTech, postgres]],
    ['Express error handling', 'Backend practice', 40, 3, [node, typescript]],
    ['Accessible dashboard layout', 'Design review', 65, 5, [react, css]],
  ] as const;

  for (const [topic, source, minutes, daysAgo, techs] of learningSessions) {
    await prisma.learningSession.create({
      data: {
        userId: user.id,
        topic,
        source,
        minutes,
        confidence: 4,
        notes: 'Seeded learning session.',
        sessionDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * daysAgo),
        technologies: {
          create: techs.map((technology) => ({ technologyId: technology.id })),
        },
      },
    });
  }

  await prisma.goal.createMany({
    data: [
      {
        userId: user.id,
        projectId: codeTrail.id,
        title: 'Log 12 focused work hours this week',
        description: 'Protect deep work blocks before adding new polish.',
        cadence: 'WEEKLY',
        targetValue: 12,
        currentValue: 0,
        unit: 'hours',
        dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5),
      },
      {
        userId: user.id,
        projectId: codeTrail.id,
        title: 'Ship the first deployable milestone',
        description: 'Backend, frontend, and database all running together.',
        cadence: 'MILESTONE',
        targetValue: 1,
        currentValue: 0,
        unit: 'release',
        dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      },
    ],
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
