import App from "./App";
import TenantApp from "./TenantApp";

export default function Application() {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === "/dashboard" || path === "/my-agent" ? <TenantApp /> : <App />;
}
