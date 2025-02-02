import React from "react";

function Home() {
  return (
    <div>
      <div class="container">
        <section>
          <h1>Sparky Control System</h1>
          <p>
            A modern MERN-stack application for controlling and monitoring the
            Sparky cable pulling machine, replacing the legacy VBA-based control
            system.
          </p>
        </section>

        <section>
          <h2>Overview</h2>
          <p>
            The Sparky Control System is a comprehensive solution for automating
            and tracking cable pulling operations. It interfaces with existing
            PLC hardware while providing a modern web interface and robust data
            management capabilities.
          </p>
        </section>

        <section>
          <h2>Core Functionality</h2>

          <h3>Hardware Control</h3>
          <ul>
            <li>Controls cable spool motor operation</li>
            <li>Monitors optical encoder feedback for precise measurements</li>
            <li>Interfaces with Rockwell Automation PLC via RSLinx</li>
            <li>Real-time tracking of cable quantities pulled</li>
          </ul>

          <h3>Data Management</h3>
          <ul>
            <li>User authentication and authorization</li>
            <li>Project tracking and management</li>
            <li>Cable type inventory management</li>
            <li>Detailed logging of cable pulling operations</li>
            <li>Automated report generation and email distribution</li>
          </ul>
        </section>

        <section>
          <h2>Technical Architecture</h2>

          <h3>Frontend Layer</h3>
          <ul>
            <li>
              <strong>Framework</strong>: React
            </li>
            <li>
              <strong>Key Features</strong>:
              <ul>
                <li>Real-time machine control interface</li>
                <li>Project and inventory management dashboards</li>
                <li>User management interface</li>
                <li>Reporting and analytics views</li>
              </ul>
            </li>
          </ul>

          <h3>Backend Layer</h3>
          <ul>
            <li>
              <strong>Runtime</strong>: Node.js
            </li>
            <li>
              <strong>API Framework</strong>: Express
            </li>
            <li>
              <strong>Key Responsibilities</strong>:
              <ul>
                <li>RESTful API endpoints</li>
                <li>Business logic implementation</li>
                <li>PLC communication via RSLinx</li>
                <li>Report generation and email dispatch</li>
                <li>Authentication and authorization</li>
              </ul>
            </li>
          </ul>

          <h3>Database Layer</h3>
          <ul>
            <li>
              <strong>Database</strong>: MySQL
            </li>
            <li>
              <strong>Schema</strong>:
              <ul>
                <li>Users: Store user credentials and permissions</li>
                <li>Projects: Track ongoing cable pulling projects</li>
                <li>Items: Catalog of cable types and specifications</li>
                <li>Checkouts: Log of cable pulling operations</li>
              </ul>
            </li>
          </ul>

          <h3>Hardware Integration Layer</h3>
          <ul>
            <li>
              <strong>PLC</strong>: Rockwell Automation
            </li>
            <li>
              <strong>Communication</strong>: RSLinx
            </li>
            <li>
              <strong>Components</strong>:
              <ul>
                <li>Motor control system</li>
                <li>
                  Optical encoder (retroreflective photo eye with perforated
                  disk)
                </li>
                <li>Cable spool mechanism</li>
              </ul>
            </li>
          </ul>
        </section>

        <section>
          <h2>System Benefits</h2>

          <h3>Improved Reliability</h3>
          <ul>
            <li>Modern architecture with proper separation of concerns</li>
            <li>Robust error handling and logging</li>
            <li>Industry-standard security practices</li>
          </ul>

          <h3>Enhanced Maintainability</h3>
          <ul>
            <li>Well-documented codebase</li>
            <li>Modern JavaScript ecosystem</li>
            <li>Familiar tech stack for current development team</li>
            <li>Modular design for easy updates and modifications</li>
          </ul>

          <h3>Better User Experience</h3>
          <ul>
            <li>Web-based interface accessible from any device</li>
            <li>Real-time monitoring and control</li>
            <li>Automated reporting functionality</li>
            <li>Improved data visualization and analytics</li>
          </ul>
        </section>

        <section>
          <h2>Migration from Legacy System</h2>
          <p>
            This system replaces an Excel-based solution that utilized Visual
            Basic macros for:
          </p>
          <ul>
            <li>Machine control</li>
            <li>Data storage</li>
            <li>Report generation</li>
          </ul>
          <p>
            The new architecture provides a more scalable and maintainable
            solution while maintaining all existing functionality.
          </p>
        </section>

        <section>
          <h2>Getting Started</h2>
          <p>[Development setup instructions to be added]</p>
        </section>

        <section>
          <h2>Configuration</h2>
          <p>[Configuration details to be added]</p>
        </section>

        <section>
          <h2>Deployment</h2>
          <p>[Deployment instructions to be added]</p>
        </section>

        <section>
          <h2>Contributing</h2>
          <p>[Contribution guidelines to be added]</p>
        </section>
      </div>
    </div>
  );
}

export default Home;
