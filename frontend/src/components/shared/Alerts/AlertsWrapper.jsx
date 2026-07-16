import Alert from "./Alert";

const AlertsWrapper = ({ alerts, removeAlert }) => (
  <div className="fixed right-4 top-4 z-[60] flex flex-col gap-2">
    {alerts.map((alert) => (
      <Alert key={alert.id} {...alert} handleDismiss={() => removeAlert(alert.id)} />
    ))}
  </div>
);

export default AlertsWrapper;
