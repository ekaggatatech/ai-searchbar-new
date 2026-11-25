
import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

import aiRouter from "./routes/aiRouter.js";
import assistantRouter from "./routes/assistantRouter.js";
import documentRouter from "./routes/documentRoutes.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// CORS configuration
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5180",
  "http://127.0.0.1:5180",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware
app.use(express.json({ limit: "10mb" }));

// Rate limiter
const createLimiter = (limit) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many requests. Please try again later.",
    },
  });

const aiLimiter = createLimiter(50);
const assistantLimiter = createLimiter(50);
const documentLimiter = createLimiter(20);

// Main route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "HourMaker AI Backend is running!",
    endpoints: {
      ai: "/api/ai",
      assistantChat: "/api/assistant/chat",
      documents: "/api/documents",
    },
  });
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
  });
});

// API routes
app.use("/api/ai", aiLimiter, aiRouter);
app.use("/api/assistant", assistantLimiter, assistantRouter);
app.use("/api/documents", documentLimiter, documentRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Backend error:", {
    method: req.method,
    url: req.originalUrl,
    message: error?.message,
    stack: error?.stack,
  });

  if (res.headersSent) return next(error);

  const status =
    Number(error?.status || error?.statusCode) || 500;

  res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong on the server."
        : error?.message || "Something went wrong on the server.",
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`HourMaker backend running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

server.on("error", (error) => {
  console.error("Server startup error:", error);
  process.exitCode = 1;
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);

  server.close((error) => {
    if (error) {
      console.error("Error while closing server:", error);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
