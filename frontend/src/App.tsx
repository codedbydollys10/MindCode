import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Practice from "./pages/Practice";
import Reports from "./pages/Reports";
import History from "./pages/History";
import Profile from "./pages/Profile";
import Assessment from "./pages/Assessment";
import Result from "./pages/Result";
import NotFound from "./pages/NotFound";
import AuthListener from "./components/AuthListener";
import AIRecommendations from "./pages/AIRecommendations";
import CollaborativeCoding from "./pages/CollaborativeCoding";
import TeacherDashboard from "./pages/TeacherDashboard";

const queryClient = new QueryClient();

const JoinAssignmentRedirect = () => {
  const { joinCode = "" } = useParams();
  return <Navigate to={`/collaborate?assignmentCode=${encodeURIComponent(joinCode)}`} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthListener />
      <BrowserRouter>
        <Routes>
          {/* main page after login */}
          <Route path="/" element={<Landing />} />

          {/* auth */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* app sections */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/history" element={<History />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/assessment/:id" element={<Assessment />} />
          <Route path="/result/:id" element={<Result />} />
          <Route path="/recruiter/*" element={<Navigate to="/dashboard" replace />} />
          <Route path="/recommendations" element={<AIRecommendations />} />
          <Route path="/collaborate" element={<CollaborativeCoding />} />
          <Route path="/collaborate/:roomId" element={<CollaborativeCoding />} />
          <Route path="/join/:joinCode" element={<JoinAssignmentRedirect />} />
          <Route path="/teacher/dashboard" element={<TeacherDashboard />} />

          {/* fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
