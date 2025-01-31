import React from "react";
import { useNavigate } from "react-router-dom";
import logo from "../../assets/images/BW Integrated Systems.png";
const MainNavBar = () => {
  const navigate = useNavigate();

  const navigationPages = [
    { name: "Home", path: "/home" },
    { name: "Report", path: "/report" },
    { name: "Checkout", path: "/checkout" },
    { name: "Config", path: "/config" },
    // Add more pages here as needed
  ];

  return (
    <nav className="nav">
      <div className="logo-container">
        <img src={logo} alt="BW Integrated Systems" className="logo-image" />
      </div>
      <div className="nav-content">
        <div>
          <h1>Sparky Cart</h1>
        </div>
        <div className="nav-buttons-container">
          <table className="nav-buttons-table">
            <tbody>
              <tr>
                {navigationPages.map((page) => (
                  <td key={page.path}>
                    <button
                      onClick={() => navigate(page.path)}
                      className="generate-report-button"
                    >
                      {page.name}
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </nav>
  );
};

export default MainNavBar;
