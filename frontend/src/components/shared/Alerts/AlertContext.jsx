// AlertContext.js
import { createContext, useState, useCallback } from "react";
import AlertsWrapper from "./AlertsWrapper";

export const AlertContext = createContext();

export const AlertProvider = ({ children }) => {
  const [alerts, setAlerts] = useState([]);

  const addAlert = useCallback((alert) => {
    const id =
      Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    setAlerts((prevAlerts) => [...prevAlerts, { ...alert, id }]);
    return id;
  }, []);

  const removeAlert = useCallback((id) => {
    setAlerts((prevAlerts) => prevAlerts.filter((alert) => alert.id !== id));
  }, []);

  return (
    <AlertContext.Provider value={{ addAlert, removeAlert }}>
      <AlertsWrapper alerts={alerts} removeAlert={removeAlert} />
      {children}
    </AlertContext.Provider>
  );
};
