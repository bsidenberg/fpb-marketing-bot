import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MarketingBotDashboard from "../marketing-bot-dashboard.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <MarketingBotDashboard />
  </StrictMode>
);
