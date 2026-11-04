export function tenantWorkerMode(): "webhook" | "external" | "invalid" {
  const mode = process.env.TENANT_WORKER_MODE?.trim() || "webhook";
  return mode === "webhook" || mode === "external" ? mode : "invalid";
}
