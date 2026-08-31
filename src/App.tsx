import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { YoursProvider } from "@/components/YoursProvider";
import { HomePage } from "@/pages/Home";
import { SessionPage } from "@/pages/Session";
import { LoginPage } from "@/pages/Login";
import { BillingPage } from "@/pages/Billing";
import { BASE_PATH } from "@/lib/base-path";

export default function App() {
  return (
    <YoursProvider>
      <BrowserRouter basename={BASE_PATH}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/s/:slug" element={<SessionPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" />
    </YoursProvider>
  );
}
