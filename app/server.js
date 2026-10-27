// Cofrial SpA · Backend del ecosistema digital (E-commerce B2B/B2C + CRM + BI + IA)
require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const { pool } = require("./db");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "cambia-este-secreto",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
}));

app.get("/api/health", async (req, res) => {
  try {
    const [[r]] = await pool.query("SELECT NOW() AS ahora, (SELECT COUNT(*) FROM telemetria) AS lecturas");
    res.json({ ok: true, db: process.env.DB_HOST, ...r, ia: process.env.AI_PROVIDER || "local" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use("/api", require("./routes/tienda"));
app.use("/api/crm", require("./routes/crm"));
// Librerías front-end servidas localmente (la demo no depende de CDNs externos)
app.use("/vendor/bootstrap", express.static(path.join(__dirname, "node_modules/bootstrap/dist")));
app.use("/vendor/chart.js", express.static(path.join(__dirname, "node_modules/chart.js/dist")));
app.use("/vendor/leaflet", express.static(path.join(__dirname, "node_modules/leaflet/dist")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/crm", (req, res) => res.sendFile(path.join(__dirname, "public/crm/index.html")));

const PORT = Number(process.env.PORT || 80);
app.listen(PORT, () => console.log(`Cofrial escuchando en el puerto ${PORT} · BD: ${process.env.DB_HOST} · IA: ${process.env.AI_PROVIDER || "local"}`));
