// Lets a frontend hosted elsewhere (Vercel) call the API and open the transcription WebSocket.
import { config } from './config.js';

/** True when the browser Origin header is the server itself or listed in ALLOWED_ORIGINS. */
export function isAllowedOrigin(origin, host) {
  if (!origin) return true; // non-browser clients (curl, scripts) send no Origin
  if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function cors(req, res, next) {
  const { origin } = req.headers;
  if (origin && isAllowedOrigin(origin, req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
