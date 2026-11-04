import { afterEach, describe, expect, it, vi } from "vitest";
import { tenantDashboardUrl } from "./tenant-dashboard.js";
afterEach(()=>vi.unstubAllEnvs());
describe("private dashboard URLs",()=>{
  it.each(["https://app.test","https://app.test/"," https://app.test/my-agent?old=true#section "])("normalizes %s to the private dashboard",url=>{
    vi.stubEnv("APP_BASE_URL",url);expect(tenantDashboardUrl()).toBe("https://app.test/dashboard");
  });
  it("uses trusted Vercel deployment metadata when the explicit URL is absent",()=>{
    vi.stubEnv("APP_BASE_URL","");vi.stubEnv("VERCEL_URL","deploy.vercel.app");
    expect(tenantDashboardUrl()).toBe("https://deploy.vercel.app/dashboard");
  });
  it.each(["http://app.test","javascript:alert(1)","https://","https://user:password@app.test","not a URL"])("does not create a broken or credential-bearing button for %s",url=>{
    vi.stubEnv("APP_BASE_URL",url);expect(tenantDashboardUrl()).toBeNull();
  });
  it("reports missing configuration",()=>{
    vi.stubEnv("APP_BASE_URL","");vi.stubEnv("VERCEL_URL","");expect(tenantDashboardUrl()).toBeNull();
  });
});
