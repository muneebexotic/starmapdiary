const path = require("path");
const express = require("express");
const cors = require("cors");

const { env } = require("./config/env");
const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");
const entriesRoutes = require("./routes/entries.routes");
const remindersRoutes = require("./routes/reminders.routes");
const cronRoutes = require("./routes/cron.routes");

const app = express();
const publicDir = path.resolve(__dirname, "..", "public");

app.use(cors({ origin: env.frontendOrigin, credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/entries", entriesRoutes);
app.use("/api/reminders", remindersRoutes);
app.use("/api/cron", cronRoutes);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.use((_req, res) => {
  res.sendFile(path.resolve(publicDir, "index.html"));
});

module.exports = { app };
