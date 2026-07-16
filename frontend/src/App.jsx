import {
  HashRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import Report from "./pages/Report.jsx";
import Home from "./pages/Home.jsx";
import Checkout from "./pages/Checkout.jsx";
import Admin from "./pages/Admin.jsx";
import { AlertProvider } from "./components/shared/Alerts/AlertContext.jsx";
import AppShell from "./components/layout/AppShell.jsx";

function App() {
  return (
    <AlertProvider>
      <Router basename="/" hashType="noslash">
        <AppShell>
          <Routes>
            <Route path="/" element={<Navigate to="/home" />} />
            <Route path="/home" element={<Home />} />
            <Route path="/report" element={<Report />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/admin" element={<Admin />} />
            {/* Legacy route redirect */}
            <Route path="/config" element={<Navigate to="/admin" replace />} />
          </Routes>
        </AppShell>
      </Router>
    </AlertProvider>
  );
}

export default App;
