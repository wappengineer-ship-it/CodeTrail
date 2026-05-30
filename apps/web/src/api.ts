import { mockBootstrap, mockDashboard } from './mockData';
import type { AuthUser, BootstrapData, CodingSession, DashboardData, LearningSession } from './types';

const rawApiUrl = import.meta.env.VITE_API_URL || '';
const API_URL = rawApiUrl && !rawApiUrl.startsWith('http') ? `https://${rawApiUrl}` : rawApiUrl;

export class ApiError extends Error {
  constructor(public status: number) {
    super(`Request failed: ${status}`);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function loadBootstrap() {
  try {
    return await request<BootstrapData>('/bootstrap');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return mockBootstrap;
  }
}

export async function loadDashboard(range = 'week') {
  try {
    return await request<DashboardData>(`/dashboard?range=${encodeURIComponent(range)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return mockDashboard;
  }
}

export async function loadCurrentUser() {
  return request<{ user: AuthUser }>('/auth/me');
}

export async function login(payload: { email: string; password: string }) {
  return request<{ user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function register(payload: { email: string; name: string; password: string }) {
  return request<{ user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loginDemo() {
  return request<{ user: AuthUser }>('/auth/demo', { method: 'POST' });
}

export async function logout() {
  return request<void>('/auth/logout', { method: 'POST' });
}

export async function createSession(payload: unknown) {
  return request<CodingSession | LearningSession | { ok: boolean; persisted: false; reason: string }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteSession(type: 'CODING' | 'LEARNING', id: string) {
  return request<void>(`/sessions/${type}/${id}`, { method: 'DELETE' });
}

export async function updateSession(type: 'CODING' | 'LEARNING', id: string, payload: { title: string; minutes: number }) {
  return request(`/sessions/${type}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function generateWeeklySummary() {
  return request<{ content: string }>('/summaries/weekly', { method: 'POST' });
}
