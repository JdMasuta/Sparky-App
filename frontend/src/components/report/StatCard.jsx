import React from 'react';
import '../../assets/css/style.css';

const StatCard = ({ title, value, subtitle }) => (
    <div className="stat-card">
        <div className="stat-title">{title}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-subtitle">{subtitle}</div>
    </div>
);

export default StatCard;