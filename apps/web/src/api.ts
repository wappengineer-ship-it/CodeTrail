import { mockBootstrap, mockDashboard } from './mockData';
import type { BootstrapData, DashboardData } from './types';

const rawApiUrl = import.meta.env.VITE_API_URL || '';
const API_URL = rawApiUrl && !rawApiUrl.startsWith('http') ? `https://${rawApiUrl}` : rawApiUrl;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function loadBootstrap() {
  try {
    return await request<BootstrapData>('/bootstrap');
  } catch {
    return mockBootstrap;
  }
}

export async function loadDashboard() {
  try {
    return await request<DashboardData>('/dashboard');
  } catch {
    return mockDashboard;
  }
}

export async function createSession(payload: unknown) {
  return request('/sessions', {
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
