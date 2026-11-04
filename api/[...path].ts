import app from "../server/index.js";

// Vercel routes /api/* requests through this function. The Express app keeps
// the existing /api route definitions and verifies Telegram webhook secrets.
// Duration is configured in vercel.json for this Node function.
// Authenticated webhooks retain background queue work with @vercel/functions waitUntil.
export default app;

