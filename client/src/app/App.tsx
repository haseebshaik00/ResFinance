import { lazy, Suspense } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";

import { AuthCard } from "../components/AuthCard";
import { GitHubLink } from "../components/GitHubLink";
import { MediumLink } from "../components/MediumLink";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuthentication } from "../features/auth/useAuthentication";
import { NotificationCenter } from "../features/insights/NotificationCenter";

const FinanceDashboard = lazy(() =>
  import("../features/finance/FinanceDashboard").then((module) => ({
    default: module.FinanceDashboard,
  })),
);
const GroupsDashboard = lazy(() =>
  import("../features/groups/GroupsDashboard").then((module) => ({
    default: module.GroupsDashboard,
  })),
);
const CryptoDashboard = lazy(() =>
  import("../features/crypto/CryptoDashboard").then((module) => ({
    default: module.CryptoDashboard,
  })),
);

export function App() {
  const navigate = useNavigate();
  const authentication = useAuthentication();
  const authenticated =
    authentication.state === "authenticated" &&
    authentication.accessToken !== null;

  async function logout() {
    try {
      await authentication.logout();
    } finally {
      navigate("/", { replace: true });
    }
  }

  return (
    <main className={authenticated ? "app-shell" : "shell"}>
      {!authenticated && (
        <div className="welcome-actions">
          <MediumLink />
          <GitHubLink />
          <ThemeToggle />
        </div>
      )}
      {!authenticated && (
        <>
          <h1>ResFinance</h1>
          <p className="lede">
            Connect to the ResWallet extension to open your Encrypted Personal
            Finance, Bill Split, and Crypto Intelligence dashboards. Your seed
            always stays inside the extension.
          </p>
        </>
      )}
      <AuthCard
        state={authentication.state}
        message={authentication.message}
        walletAddress={authentication.identity?.address ?? null}
        actorAddress={authentication.actorAddress}
        onConnect={() => void authentication.connect()}
        onLogout={() => void logout()}
        actions={
          authenticated ? (
            <NotificationCenter accessToken={authentication.accessToken!} />
          ) : undefined
        }
      >
        {authenticated && (
          <div className="authenticated-navigation">
            <nav className="dashboard-nav" aria-label="ResFinance dashboards">
              <NavLink to="/finance">Personal Finance</NavLink>
              <NavLink to="/groups">Friends &amp; Groups</NavLink>
              <NavLink to="/crypto">Crypto Intelligence</NavLink>
            </nav>
          </div>
        )}
      </AuthCard>
      {authenticated ? (
        <>
          <Routes>
            <Route
              path="/finance"
              element={
                <Suspense
                  fallback={<RouteLoading text="Opening Personal Finance…" />}
                >
                  <FinanceDashboard accessToken={authentication.accessToken!} />
                </Suspense>
              }
            />
            <Route
              path="/groups"
              element={
                <Suspense
                  fallback={<RouteLoading text="Opening Friends & Groups…" />}
                >
                  <GroupsDashboard
                    accessToken={authentication.accessToken!}
                    actorAddress={authentication.actorAddress!}
                  />
                </Suspense>
              }
            />
            <Route
              path="/crypto"
              element={
                <Suspense
                  fallback={
                    <RouteLoading text="Opening Crypto Intelligence…" />
                  }
                >
                  <CryptoDashboard accessToken={authentication.accessToken!} />
                </Suspense>
              }
            />
            <Route
              path="/insights"
              element={<Navigate to="/finance#smart-insights" replace />}
            />
            <Route path="*" element={<Navigate to="/finance" replace />} />
          </Routes>
        </>
      ) : null}
    </main>
  );
}

function RouteLoading({ text }: { text: string }) {
  return (
    <section className="dashboard-state" aria-live="polite">
      <span className="loading-orb" aria-hidden="true" />
      <h2>{text}</h2>
    </section>
  );
}
