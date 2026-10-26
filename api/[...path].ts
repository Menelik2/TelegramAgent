import app from "../server/index.js";

// Vercel routes /api/* requests through this function. The Express app keeps
// the existing /api route definitions and verifies Telegram webhook secrets.
export default app;
