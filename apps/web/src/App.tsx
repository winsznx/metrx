import {Route, Routes, useLocation} from "react-router-dom";
import {useEffect} from "react";
import {Page} from "@/components/Layout";
import {EmptyState, Section} from "@/components/primitives";
import Landing from "@/routes/Landing";
import Dashboard from "@/routes/Dashboard";
import Create from "@/routes/Create";
import Orders from "@/routes/Orders";
import OrderDetail from "@/routes/OrderDetail";
import Operator from "@/routes/Operator";
import Onboarding from "@/routes/Onboarding";
import Settings from "@/routes/Settings";
import Verify from "@/routes/Verify";
import {ProofDetail, ProofHub} from "@/routes/Proof";
import {Architecture, Security, WhatIsReal} from "@/routes/Docs";

function ScrollToTop() {
  const {pathname} = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export default function App() {
  return (
    <Page>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Dashboard />} />
        <Route path="/app/onboarding" element={<Onboarding />} />
        <Route path="/app/settings" element={<Settings />} />
        <Route path="/app/create" element={<Create />} />
        <Route path="/app/orders" element={<Orders />} />
        <Route path="/app/orders/:id" element={<OrderDetail />} />
        <Route path="/app/operator" element={<Operator />} />
        <Route path="/app/verify/:id" element={<Verify />} />
        <Route path="/proof" element={<ProofHub />} />
        <Route path="/proof/:id" element={<ProofDetail />} />
        <Route path="/docs/what-is-real" element={<WhatIsReal />} />
        <Route path="/docs/security" element={<Security />} />
        <Route path="/docs/architecture" element={<Architecture />} />
        <Route
          path="*"
          element={
            <Section className="py-24">
              <EmptyState title="No page here">That route does not exist in Metrx.</EmptyState>
            </Section>
          }
        />
      </Routes>
    </Page>
  );
}
