// Alert.js
import { useEffect } from "react";

const severityIcons = {
  info: {
    svgPath:
      "M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z",
  },
  success: {
    svgPath: "M5.64 13.36l-2.28-2.28-1.28 1.28 3.56 3.56 7.72-7.72-1.28-1.28z",
  },
  warning: {
    svgPath:
      "M10 4.5a1 1 0 0 1 2 0v5a1 1 0 1 1-2 0V4.5zm0 8a1 1 0 1 1 2 0v.5a1 1 0 1 1-2 0v-.5z",
  },
  error: {
    svgPath:
      "M10 1C4.48 1 0 5.48 0 11s4.48 10 10 10 10-4.48 10-10S15.52 1 10 1zm1 15H9v-2h2v2zm0-4H9V5h2v7z",
  },
};

const Alert = ({
  message = "",
  severity = "info",
  timeout = 0,
  handleDismiss = null,
}) => {
  useEffect(() => {
    if (timeout > 0 && handleDismiss) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, timeout * 1000);
      return () => clearTimeout(timer);
    }
  }, [timeout, handleDismiss]);

  if (!message) return null;

  return (
    <div className={`alert alert-${severity}`} role="alert">
      <div className="alert-content">
        <div className="alert-icon">
          <svg
            className="alert-icon-svg"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
          >
            <path d={severityIcons[severity]?.svgPath} />
          </svg>
        </div>
        <div className="alert-text">
          <p className="alert-title">
            {severity.charAt(0).toUpperCase() + severity.slice(1)}
          </p>
          <p className="alert-message">{message}</p>
        </div>
        {handleDismiss && (
          <button onClick={handleDismiss} className="alert-close">
            <svg
              className="alert-close-svg"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
            >
              <title>Close</title>
              <path d="M14.348 14.849a1 1 0 0 1-1.414 0L10 11.414l-2.934 2.935a1 1 0 1 1-1.414-1.414l2.935-2.934-2.935-2.934a1 1 0 1 1 1.414-1.414L10 8.586l2.934-2.935a1 1 0 1 1 1.414 1.414L11.414 10l2.935 2.934a1 1 0 0 1 0 1.415z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default Alert;
