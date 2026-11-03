import app from "../server/index.js";

// Vercel routes /api/* requests through this function. The Express app keeps
// the existing /api route definitions and verifies Telegram webhook secrets.
// Allow the configured 10-second reply delay plus Gemini and Telegram API latency.
export const maxDuration = 60;
export default app;
