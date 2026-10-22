// Where the backend (Express API + WebSocket) lives.
// Empty string = same origin: local development, or when the Express server serves this page.
// For the Vercel deployment, set RENDER_URL to your Render service URL.
const RENDER_URL = 'https://speech-to-text-api-3z1a.onrender.com';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

window.APP_CONFIG = {
  backendUrl: isLocal || RENDER_URL.includes('YOUR-SERVICE') ? '' : RENDER_URL.replace(/\/+$/, ''),
};
