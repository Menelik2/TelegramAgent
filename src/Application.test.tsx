// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Application from "./Application";
vi.mock("./App",()=>({default:()=> <div>Administrator workspace</div>}));
vi.mock("./TenantApp",()=>({default:()=> <div>Private auto-reply dashboard</div>}));
afterEach(()=>{cleanup();window.history.replaceState({},"","/");});
describe("dashboard entry routes",()=>{
  it.each(["/dashboard","/dashboard/","/dashboard?startapp=agent","/my-agent","/my-agent/"])("opens private controls at %s",path=>{
    window.history.replaceState({},"",path);render(<Application/>);
    expect(screen.getByText("Private auto-reply dashboard")).toBeTruthy();
    expect(screen.queryByText("Administrator workspace")).toBeNull();
  });
  it("keeps the existing administrator workspace at the root",()=>{
    render(<Application/>);expect(screen.getByText("Administrator workspace")).toBeTruthy();
  });
});
