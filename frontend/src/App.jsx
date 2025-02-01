import React from "react";
import {
  HashRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import Report from "./pages/Report.jsx";
import Home from "./pages/Home.jsx";
import Checkout from "./pages/Checkout.jsx";
import Config from "./pages/Config.jsx";
import { AlertProvider } from "./components/shared/Alerts/AlertContext.jsx";
import MainNavBar from "./components/shared/MainNavBar.jsx";

function App() {
  return (
    <AlertProvider>
      <Router basename="/" hashType="noslash">
        <MainNavBar>
          <Routes>
            <Route path="/" element={<Navigate to="/home" />} />
            <Route path="/home" element={<Home />} />
            <Route path="/report" element={<Report />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/config" element={<Config />} />
          </Routes>
        </MainNavBar>
      </Router>
    </AlertProvider>
  );
}

export default App;
