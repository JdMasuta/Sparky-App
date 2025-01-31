// AlertsWrapper.js
import Alert from "./Alert";

const AlertsWrapper = ({ alerts, removeAlert }) => (
  <div className="alerts-wrapper">
    {alerts.map((alert) => (
      <Alert
        key={alert.id}
        {...alert}
        handleDismiss={() => removeAlert(alert.id)}
      />
    ))}
  </div>
);

export default AlertsWrapper;
