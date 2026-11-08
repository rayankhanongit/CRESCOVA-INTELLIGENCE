import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { api, ApiError } from "./lib/api";
import type { User } from "./lib/types";
import AuditDetailPage from "./pages/AuditDetail";
import AuditsList from "./pages/AuditsList";
import CalendarPage from "./pages/Calendar";
import ClientDetail from "./pages/ClientDetail";
import ReportDetail from "./pages/ReportDetail";
import ReportsPage from "./pages/Reports";
import ClientsPage from "./pages/Clients";
import LeadDetail from "./pages/LeadDetail";
import LeadsPage from "./pages/Leads";
import Login from "./pages/Login";
import ProposalEditor from "./pages/ProposalEditor";
import ProposalsPage from "./pages/Proposals";
import TasksPage from "./pages/Tasks";
import ContentStudio from "./pages/ContentStudio";
import KeywordsPage from "./pages/Keywords";
import PageDetailPage from "./pages/PageDetail";
import SettingsPage from "./pages/Settings";
import WebsiteDetail from "./pages/WebsiteDetail";
import WebsitesPage from "./pages/Websites";

// Chart-heavy pages load on demand so the charting library stays out of the first download.
const OverviewPage = lazy(() => import("./pages/Overview"));
const HistoryPage = lazy(() => import("./pages/History"));
const CompetitorsPage = lazy(() => import("./pages/Competitors"));

export default function App() {
  const me = useQuery({
    queryKey: ["me"], retry: false, staleTime: Infinity,
    queryFn: async () => { try { return await api<User>("/auth/me"); } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; } },
  });
  if (me.isLoading) return <Spinner label="Loading workspace…" />;
  if (me.error) return <div className="p-10 text-center text-sm text-danger" role="alert">Can't reach the server. Is the backend running on port 8000?</div>;
  if (!me.data) return <Login />;
  const user = me.data;
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route element={<Layout user={user} />}>
        <Route index element={<OverviewPage />} />
        <Route path="websites" element={<WebsitesPage />} />
        <Route path="websites/:id" element={<WebsiteDetail />} />
        <Route path="audits" element={<AuditsList />} />
        <Route path="audits/:id" element={<AuditDetailPage />} />
        <Route path="pages/:id" element={<PageDetailPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:id" element={<LeadDetail />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="proposals" element={<ProposalsPage />} />
        <Route path="proposals/:id" element={<ProposalEditor />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="keywords" element={<KeywordsPage />} />
        <Route path="competitors" element={<CompetitorsPage />} />
        <Route path="content-studio" element={<ContentStudio />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:id" element={<ReportDetail />} />
        <Route path="settings" element={<SettingsPage user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
