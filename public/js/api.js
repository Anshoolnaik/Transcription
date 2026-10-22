// Thin client for the REST API.
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  config: () => request('/config'),
  stats: () => request('/stats'),
  list: ({ q, page, limit }) => request(`/transcriptions?${new URLSearchParams({ q, page, limit })}`),
  get: (id) => request(`/transcriptions/${id}`),
  create: (body) => request('/transcriptions', { method: 'POST', body }),
  update: (id, body) => request(`/transcriptions/${id}`, { method: 'PUT', body }),
  remove: (id) => request(`/transcriptions/${id}`, { method: 'DELETE' }),
};
