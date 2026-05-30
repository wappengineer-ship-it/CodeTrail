import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { env } from './env.js';
import { prisma } from './prisma.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'codetrail_session';
const SESSION_DAYS = 30;

export type PublicUser = Pick<User, 'id' | 'name' | 'email' | 'timezone'>;
export type AuthenticatedRequest = Request & { user: PublicUser };

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header: string | undefined) {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [key, ...value] = cookie.split('=');
        return [key, decodeURIComponent(value.join('='))];
      }),
  );
}

function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    timezone: user.timezone,
  };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string | null) {
  if (!storedHash) return false;

  const [salt, storedKey] = storedHash.split(':');
  if (!salt || !storedKey) return false;

  const key = (await scrypt(password, salt, 64)) as Buffer;
  const stored = Buffer.from(storedKey, 'hex');
  return key.length === stored.length && timingSafeEqual(key, stored);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  });
}

export async function createAuthSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });

  return token;
}

export async function destroyAuthSession(req: Request) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return;

  await prisma.authSession.deleteMany({
    where: { tokenHash: hashToken(token) },
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const session = await prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt <= new Date()) {
      clearSessionCookie(res);
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    (req as AuthenticatedRequest).user = publicUser(session.user);
    next();
  } catch (error) {
    next(error);
  }
}

export function toPublicUser(user: User) {
  return publicUser(user);
}
