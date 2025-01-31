# Sparky Control System

A modern MERN-stack application for controlling and monitoring the Sparky cable pulling machine, replacing the legacy VBA-based control system.

## Overview

The Sparky Control System is a comprehensive solution for automating and tracking cable pulling operations. It interfaces with existing PLC hardware while providing a modern web interface and robust data management capabilities.

## Core Functionality

### Hardware Control

- Controls cable spool motor operation
- Monitors optical encoder feedback for precise measurements
- Interfaces with Rockwell Automation PLC via RSLinx
- Real-time tracking of cable quantities pulled

### Data Management

- User authentication and authorization
- Project tracking and management
- Cable type inventory management
- Detailed logging of cable pulling operations
- Automated report generation and email distribution

## Technical Architecture

### Frontend Layer

- **Framework**: React
- **Key Features**:
  - Real-time machine control interface
  - Project and inventory management dashboards
  - User management interface
  - Reporting and analytics views

### Backend Layer

- **Runtime**: Node.js
- **API Framework**: Express
- **Key Responsibilities**:
  - RESTful API endpoints
  - Business logic implementation
  - PLC communication via RSLinx
  - Report generation and email dispatch
  - Authentication and authorization

### Database Layer

- **Database**: MySQL
- **Schema**:
  - Users: Store user credentials and permissions
  - Projects: Track ongoing cable pulling projects
  - Items: Catalog of cable types and specifications
  - Checkouts: Log of cable pulling operations

### Hardware Integration Layer

- **PLC**: Rockwell Automation
- **Communication**: RSLinx
- **Components**:
  - Motor control system
  - Optical encoder (retroreflective photo eye with perforated disk)
  - Cable spool mechanism

## System Benefits

### Improved Reliability

- Modern architecture with proper separation of concerns
- Robust error handling and logging
- Industry-standard security practices

### Enhanced Maintainability

- Well-documented codebase
- Modern JavaScript ecosystem
- Familiar tech stack for current development team
- Modular design for easy updates and modifications

### Better User Experience

- Web-based interface accessible from any device
- Real-time monitoring and control
- Automated reporting functionality
- Improved data visualization and analytics

## Migration from Legacy System

This system replaces an Excel-based solution that utilized Visual Basic macros for:

- Machine control
- Data storage
- Report generation

The new architecture provides a more scalable and maintainable solution while maintaining all existing functionality.

## Getting Started

[Development setup instructions to be added]

## Configuration

[Configuration details to be added]

## Deployment

[Deployment instructions to be added]

## Contributing

[Contribution guidelines to be added]
