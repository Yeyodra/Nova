import { lazy, Suspense, useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import { checkSetupStatus, isAuthenticated, logout } from "./lib/api";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Accounts = lazy(() => import("./pages/Accounts"));
const AccountList = lazy(() => import("./pages/AccountList"));
const Models = lazy(() => import("./pages/Models"));
const ApiKey = lazy(() => import("./pages/ApiKey"));
const Requests = lazy(() => import("./pages/Requests"));
const Usage = lazy(() => import("./pages/Usage"));
const Settings = lazy(() => import("./pages/Settings"));
const BotLogs = lazy(() => import("./pages/BotLogs"));
const VccPool = lazy(() => import("./pages/VccPool"));
const ProxyPool = lazy(() => import("./pages/ProxyPool"));
const ImageStudio = lazy(() => import("./pages/ImageStudio"));
const FilterRules = lazy(() => import("./pages/FilterRules"));
const EmailProviderFilter = lazy(() => import("./pages/EmailProviderFilter"));
const Integration = lazy(() => import("./pages/Integration"));
const Tunnel = lazy(() => import("./pages/Tunnel"));
const CodexOAuthCallback = lazy(() => import("./pages/CodexOAuthCallback"));

type AuthState = "loading" | "setup" | "login" | "authenticated";

function RouteFallback() {
  return <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>;
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    async function check() {
      try {
        const { setup } = await checkSetupStatus();
        if (!setup) {
          setAuthState("setup");
        } else if (isAuthenticated()) {
          setAuthState("authenticated");
        } else {
          setAuthState("login");
        }
      } catch {
        setAuthState("login");
      }
    }
    check();
  }, []);

  function handleSetup() {
    setAuthState("login");
  }

  function handleLogin() {
    setAuthState("authenticated");
  }

  function handleLogout() {
    logout();
    setAuthState("login");
  }

  if (authState === "loading") {
    return <div className="flex h-screen items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>;
  }

  if (authState === "setup") {
    return <Setup onSetup={handleSetup} />;
  }

  if (authState === "login") {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<Layout onLogout={handleLogout} />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/:provider" element={<AccountList />} />
          <Route path="/email-provider-filter" element={<EmailProviderFilter />} />
          <Route path="/models" element={<Models />} />
          <Route path="/api-key" element={<ApiKey />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/bot-logs" element={<BotLogs />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/vcc-pool" element={<VccPool />} />
          <Route path="/proxy-pool" element={<ProxyPool />} />
          <Route path="/filter-rules" element={<FilterRules />} />
          <Route path="/integration" element={<Integration />} />
          <Route path="/tunnel" element={<Tunnel />} />
          <Route path="/image-studio" element={<ImageStudio />} />
          <Route path="/oauth/codex/callback" element={<CodexOAuthCallback />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
