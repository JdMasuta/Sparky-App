import React from "react";
import { useNavigate } from "react-router-dom";
import logo from "../../assets/images/BW Integrated Systems.png";

const MainNavBar = ({ children }) => {
  const navigate = useNavigate();

  const navigationPages = [
    { name: "Home", path: "/home" },
    { name: "Report", path: "/report" },
    { name: "Checkout", path: "/checkout" },
    { name: "Config", path: "/config" },
  ];

  return (
    <div className="layout-container">
      {/* Top Header */}
      <header className="top-header">
        <div className="logo-container">
          <img src={logo} alt="BW Integrated Systems" className="logo-image" />
        </div>
        <h1 className="sparky-title">Sparky Cart</h1>
      </header>

      {/* Left Sidebar */}
      <aside className="sidebar">
        <nav className="nav-menu">
          {navigationPages.map((page) => (
            <button
              key={page.path}
              onClick={() => navigate(page.path)}
              className="nav-button"
            >
              {page.name}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content (children will be your routed pages) */}
      <main className="main-content">{children}</main>
    </div>
  );
};

export default MainNavBar;
