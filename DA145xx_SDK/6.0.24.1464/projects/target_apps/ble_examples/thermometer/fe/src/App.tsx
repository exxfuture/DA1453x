import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from 'react-oidc-context';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { RequireRole } from './components/RequireRole';
import { AdminPage } from './pages/AdminPage';
import { ConnectPage } from './pages/ConnectPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { DoctorAuditPage } from './pages/DoctorAuditPage';
import { DoctorDashboardPage } from './pages/DoctorDashboardPage';
import { EventsPage } from './pages/EventsPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { PatientReportPage } from './pages/PatientReportPage';
import { PatientsPage } from './pages/PatientsPage';
import { SettingsPage } from './pages/SettingsPage';
import { roleOf, userManager } from './auth/oidc';

const queryClient = new QueryClient();

const HOME_BY_ROLE = {
  customer: '/dashboard',
  doctor: '/dashboard',
  admin: '/admin',
} as const;

/** /dashboard is role-branched: customers get their device/history view,
 *  doctors get the patient-fleet overview (DoctorDashboardPage). */
function DashboardRoute() {
  const { user } = useAuth();
  return roleOf(user) === 'doctor' ? <DoctorDashboardPage /> : <DashboardPage />;
}

function Home() {
  const { user } = useAuth();
  const role = roleOf(user);
  return <Navigate to={role ? HOME_BY_ROLE[role] : '/dashboard'} replace />;
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <Loader2 className="size-6 animate-spin text-ink-muted" aria-hidden />
    </div>
  );
}

function AuthGate() {
  const auth = useAuth();

  // isLoading covers both the initial silent-SSO check on first load and the
  // authorization-code exchange right after Keycloak redirects back here —
  // neither the app nor the login page should render mid-flow.
  if (auth.isLoading) {
    return <LoadingScreen />;
  }

  if (auth.error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-page px-4 text-center">
        <p className="text-body text-danger-text">Sign-in failed: {auth.error.message}</p>
        <button
          type="button"
          onClick={() => void auth.signinRedirect()}
          className="text-body font-semibold text-primary-600 underline dark:text-primary-300"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-page">
          <NavBar />
          <main className="pb-20 md:pb-0">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route
                path="/dashboard"
                element={
                  <RequireRole allow={['customer', 'doctor']}>
                    <DashboardRoute />
                  </RequireRole>
                }
              />
              <Route
                path="/devices"
                element={
                  <RequireRole allow={['customer']}>
                    <DevicesPage />
                  </RequireRole>
                }
              />
              <Route
                path="/connect"
                element={
                  <RequireRole allow={['customer']}>
                    <ConnectPage />
                  </RequireRole>
                }
              />
              <Route
                path="/history"
                element={
                  <RequireRole allow={['customer']}>
                    <HistoryPage />
                  </RequireRole>
                }
              />
              <Route
                path="/settings"
                element={
                  <RequireRole allow={['customer', 'doctor', 'admin']}>
                    <SettingsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/patients"
                element={
                  <RequireRole allow={['doctor']}>
                    <PatientsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/patients/:patientId/report"
                element={
                  <RequireRole allow={['doctor']}>
                    <PatientReportPage />
                  </RequireRole>
                }
              />
              <Route
                path="/events"
                element={
                  <RequireRole allow={['doctor']}>
                    <EventsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/audit"
                element={
                  <RequireRole allow={['doctor']}>
                    <DoctorAuditPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <RequireRole allow={['admin']}>
                    <AdminPage />
                  </RequireRole>
                }
              />
              {/* Unknown deep links (bookmarks to removed paths, typos) fall back home instead of a blank main area. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <AuthProvider
      userManager={userManager}
      onSigninCallback={() => {
        // Strips the ?code=&state= (or ?kc_action_status=) query params
        // Keycloak appends to the redirect back here, so they don't linger
        // in the URL bar or get re-processed on a later reload.
        window.history.replaceState({}, document.title, window.location.pathname);
      }}
    >
      <AuthGate />
    </AuthProvider>
  );
}
