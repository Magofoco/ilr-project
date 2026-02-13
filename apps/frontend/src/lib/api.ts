import { supabase } from './supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string || 'http://localhost:3001';

/**
 * Custom error class for API responses.
 * Carries the HTTP status code so callers can distinguish
 * 401 (expired token) from other errors.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  /**
   * Set to true to skip sending the auth token.
   * By default, all requests include the Supabase JWT.
   */
  public?: boolean;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { public: isPublic = false, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  // Attach auth token by default — opt out with { public: true }
  if (!isPublic) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...rest,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }));
    const message = body.message || `HTTP ${response.status}`;

    // 401 = token expired or invalid → sign out and redirect to login
    if (response.status === 401 && !isPublic) {
      await supabase.auth.signOut();
      window.location.href = '/login';
    }

    throw new ApiError(message, response.status);
  }

  // Handle 204 No Content (e.g. DELETE responses)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'GET' });
  },

  post<T>(endpoint: string, data?: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  patch<T>(endpoint: string, data?: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  delete<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'DELETE' });
  },
};
